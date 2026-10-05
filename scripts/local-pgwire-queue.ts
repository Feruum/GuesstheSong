import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketHandler } from "@electric-sql/pglite-socket";
import { createServer, type Server, type Socket } from "node:net";

interface QueuedMessage {
  handlerId: number;
  message: Uint8Array;
  onData: (data: Uint8Array) => void;
  resolve: (bytes: number) => void;
  reject: (error: Error) => void;
}
const sync = Uint8Array.from([83, 0, 0, 0, 4]);
const rollback = Buffer.concat([Buffer.from([81, 0, 0, 0, 13]), Buffer.from("ROLLBACK\0")]);
const asError = (error: unknown) => error instanceof Error ? error : new Error(String(error));

/**
 * PGlite has one backend session. The app uses unnamed statements; this queue
 * keeps Parse/Bind/Execute/Sync and explicit transactions on one handler.
 * It does not provide independent named statements or other session state.
 */
class CycleOwningQueue {
  private queue: QueuedMessage[] = [];
  private owner: number | null = null;
  private processing = false;
  private disconnected = new Set<number>();
  private cleanup = new Map<number, { promise: Promise<void>; resolve: () => void }>();
  private responseBuffer: Buffer = Buffer.alloc(0);

  constructor(private readonly db: PGlite) {}

  enqueue(handlerId: number, message: Uint8Array, onData: QueuedMessage["onData"]): Promise<number> {
    if (this.disconnected.has(handlerId)) return Promise.reject(new Error("Handler disconnected"));
    return new Promise((resolve, reject) => {
      this.queue.push({ handlerId, message, onData, resolve, reject });
      void this.processQueue();
    });
  }

  getQueueLength() { return this.queue.length; }

  clearQueueForHandler(handlerId: number): void {
    this.disconnected.add(handlerId);
    this.queue = this.queue.filter(message => {
      if (message.handlerId !== handlerId) return true;
      message.reject(new Error("Handler disconnected"));
      return false;
    });
    void this.processQueue();
  }

  clearTransactionIfNeeded(handlerId: number): Promise<void> {
    if (this.owner !== handlerId) return Promise.resolve();
    const previous = this.cleanup.get(handlerId);
    if (previous) return previous.promise;
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    this.cleanup.set(handlerId, { promise, resolve });
    this.disconnected.add(handlerId);
    void this.processQueue();
    return promise;
  }

  private completeCleanup(handlerId: number): void {
    this.cleanup.get(handlerId)?.resolve();
    this.cleanup.delete(handlerId);
  }

  private observeResponse(data: Uint8Array, ready: (status: string) => void): void {
    this.responseBuffer = Buffer.concat([this.responseBuffer, Buffer.from(data)]);
    while (this.responseBuffer.length >= 5) {
      const length = this.responseBuffer.readInt32BE(1);
      if (length < 4) throw new Error("Invalid PostgreSQL response length");
      if (this.responseBuffer.length < length + 1) return;
      if (this.responseBuffer[0] === 90 && length === 5) ready(String.fromCharCode(this.responseBuffer[5]));
      this.responseBuffer = this.responseBuffer.subarray(length + 1);
    }
  }

  private async recoverOwner(): Promise<void> {
    const handlerId = this.owner;
    try {
      await this.db.runExclusive(async () => {
        // Sync clears an unfinished extended cycle, including ignore-until-Sync
        // after a protocol error. An explicit transaction then needs rollback.
        await this.db.execProtocolRawStream(sync, { onRawData: () => {} });
        if (this.db.isInTransaction()) await this.db.execProtocolRawStream(rollback, { onRawData: () => {} });
      });
    } catch (error) {
      // A failed backend recovery must reject waiters, not leave them frozen.
      for (const queued of this.queue.splice(0)) queued.reject(asError(error));
    } finally {
      this.owner = null;
      this.responseBuffer = Buffer.alloc(0);
      if (handlerId !== null) this.completeCleanup(handlerId);
    }
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      for (;;) {
        if (this.owner !== null && this.disconnected.has(this.owner)) {
          await this.recoverOwner();
          continue;
        }
        const index = this.owner === null ? 0 : this.queue.findIndex(message => message.handlerId === this.owner);
        if (index < 0 || this.queue.length === 0) break;
        const queued = this.queue.splice(index, 1)[0];
        this.owner = queued.handlerId;
        let bytes = 0;
        let ready: string | undefined;
        try {
          await this.db.runExclusive(() => this.db.execProtocolRawStream(queued.message, {
            onRawData: data => {
              bytes += data.length;
              this.observeResponse(data, status => { ready = status; });
              queued.onData(data);
            },
          }));
          // Parse/Flush emit no ReadyForQuery. Transaction statuses T/E keep
          // ownership even after Sync; only idle I can release this backend.
          if (ready === "I" && !this.db.isInTransaction()) {
            this.owner = null;
            this.completeCleanup(queued.handlerId);
          }
          queued.resolve(bytes);
        } catch (error) {
          await this.recoverOwner();
          queued.reject(asError(error));
        }
      }
    } finally { this.processing = false; }
  }
}

export interface LocalPgWireOptions { db: PGlite; host?: "127.0.0.1"; port?: number; maxConnections?: number }

/** Local development bridge using only the package's public socket handler. */
export class LocalPgWireServer extends EventTarget {
  private server: Server | null = null;
  private readonly queue: CycleOwningQueue;
  private readonly handlers = new Map<PGLiteSocketHandler, Socket>();
  private port: number;
  private readonly maxConnections: number;

  constructor(private readonly options: LocalPgWireOptions) {
    super();
    this.queue = new CycleOwningQueue(options.db);
    this.port = options.port ?? 15432;
    this.maxConnections = options.maxConnections ?? 32;
  }

  async start(): Promise<void> {
    if (this.server) throw new Error("Local PostgreSQL bridge is already running");
    await this.options.db.waitReady;
    const server = createServer(socket => {
      if (!this.server || this.handlers.size >= this.maxConnections) { socket.destroy(); return; }
      // The package does not export its nominal queue class. Its public handler
      // only calls these four public methods; this is the sole structural cast.
      const queryQueue = this.queue as unknown as ConstructorParameters<typeof PGLiteSocketHandler>[0]["queryQueue"];
      const handler = new PGLiteSocketHandler({ queryQueue, closeOnDetach: true });
      this.handlers.set(handler, socket);
      const remove = () => { this.handlers.delete(handler); };
      handler.addEventListener("close", remove);
      handler.addEventListener("error", remove);
      void handler.attach(socket).catch(async error => {
        remove(); socket.destroy();
        await handler.detach(true);
        this.dispatchEvent(new CustomEvent("error", { detail: error }));
      });
    });
    this.server = server;
    server.maxConnections = this.maxConnections;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, "127.0.0.1", () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") { reject(new Error("Expected a local TCP address")); return; }
        this.port = address.port;
        server.on("error", error => this.dispatchEvent(new CustomEvent("error", { detail: error })));
        resolve();
      });
    });
  }

  getServerConn() { return `127.0.0.1:${this.port}`; }
  getStats() { return { activeConnections: this.handlers.size, queuedQueries: this.queue.getQueueLength(), maxConnections: this.maxConnections }; }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await Promise.allSettled([...this.handlers].map(([handler, socket]) => { socket.destroy(); return handler.detach(true); }));
    this.handlers.clear();
    await closed;
  }
}
