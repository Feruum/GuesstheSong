import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Client } from "pg";
import { parse, serialize } from "pg-protocol";
import { createConnection, type Socket } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

type WireMessage = { name: string; message?: string; status?: string; fields?: readonly unknown[] };
type Server = Pick<PGLiteSocketServer, "start" | "stop" | "getServerConn">;
let database: PGlite;
let server: Server;
let port: number;
const sockets = new Set<Socket>();
const clients = new Set<Client>();

beforeAll(async () => { database = await PGlite.create(); });
afterAll(async () => { await database.close(); });
beforeEach(async () => {
  // This database is in memory, never the app's DATABASE_URL or .data/postgres.
  await database.execProtocolRaw(serialize.sync());
  if (database.isInTransaction()) await database.execProtocolRaw(serialize.query("ROLLBACK"));
  const options = { db: database, host: "127.0.0.1" as const, port: 0, maxConnections: 32 };
  server = process.env.PGWIRE_TEST_LEGACY === "1"
    ? new PGLiteSocketServer(options)
    : new (await import("../scripts/local-pgwire-queue")).LocalPgWireServer(options);
  await server.start();
  port = Number(server.getServerConn().split(":").at(-1));
});
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  await Promise.allSettled([...clients].map(client => client.end()));
  clients.clear();
  await server.stop();
});

function sql(count: number) {
  return { text: "SELECT " + Array.from({ length: count }, (_, i) => `$${i + 1}::integer AS v${i + 1}`).join(","), values: Array.from({ length: count }, (_, i) => i + 1) };
}
function parseQuery(count: number) { return serialize.parse({ text: sql(count).text, name: "", types: [] }); }
function bindQuery(count: number) {
  return Buffer.concat([serialize.bind({ portal: "", statement: "", values: sql(count).values.map(String) }), serialize.describe({ type: "P", name: "" }), serialize.execute({ portal: "" }), serialize.sync()]);
}
function fullQuery(count: number) { return Buffer.concat([parseQuery(count), bindQuery(count)]); }
function columns(messages: WireMessage[]) { return messages.find(message => message.name === "rowDescription")?.fields?.length; }
function errors(messages: WireMessage[]) { return messages.filter(message => message.name === "error").map(message => message.message); }

async function wire() {
  const socket = createConnection({ host: "127.0.0.1", port });
  sockets.add(socket);
  const messages: WireMessage[] = [];
  const notifications = new Set<() => void>();
  void parse(socket, message => { messages.push(message); notifications.forEach(notify => notify()); });
  const until = (name: string) => new Promise<WireMessage[]>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${name}`)), 2000);
    function finish(error?: Error) {
      clearTimeout(timer); notifications.delete(check); socket.off("close", closed);
      if (error) reject(error);
      else {
        const index = messages.findIndex(message => message.name === name);
        resolve(messages.splice(0, index + 1));
      }
    }
    function check() { if (messages.some(message => message.name === name)) finish(); }
    function closed() { finish(new Error(`Socket closed before ${name}`)); }
    notifications.add(check); socket.once("close", closed); check();
  });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.write(serialize.startup({ user: "postgres", database: "postgres" }));
  await until("readyForQuery");
  return { socket, until };
}
async function client() {
  const connection = new Client({ host: "127.0.0.1", port, database: "postgres", user: "postgres", ssl: false, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  clients.add(connection);
  await connection.connect();
  return connection;
}

describe("isolated local PostgreSQL wire bridge", () => {
  test("concurrent unnamed queries retain their differing parameter counts", async () => {
    const a = await client(), b = await client();
    const results = await Promise.all([a.query(sql(4)), b.query(sql(54))]);
    expect(results.map(result => result.fields.length)).toEqual([4, 54]);
    expect(results.map(result => result.rows[0].v1)).toEqual([1, 1]);
  });

  test("Parse plus Flush retains ownership until that client's Bind and Sync", async () => {
    const a = await wire(), b = await wire();
    a.socket.write(Buffer.concat([parseQuery(4), serialize.flush()]));
    await a.until("parseComplete");
    b.socket.write(fullQuery(54));
    const bResult = b.until("readyForQuery");
    await delay(20);
    a.socket.write(bindQuery(4));
    const [first, second] = await Promise.all([a.until("readyForQuery"), bResult]);
    expect(errors(first)).toEqual([]);
    expect([columns(first), columns(second)]).toEqual([4, 54]);
  });

  test("an explicit transaction owns the backend across ReadyForQuery messages", async () => {
    const a = await client(), b = await client();
    await a.query("CREATE TABLE IF NOT EXISTS qa_wire_transaction(value integer)");
    await a.query("TRUNCATE qa_wire_transaction");
    await a.query("BEGIN");
    await a.query("INSERT INTO qa_wire_transaction VALUES($1)", [42]);
    let finished = false;
    const other = b.query("SELECT count(*)::integer AS count FROM qa_wire_transaction").then(result => { finished = true; return result; });
    await delay(20);
    expect(finished).toBe(false);
    await a.query("COMMIT");
    expect((await other).rows[0].count).toBe(1);
  });

  test("a Parse error waits for its owner's Sync before another query runs", async () => {
    const a = await wire(), b = await wire();
    a.socket.write(Buffer.concat([serialize.parse({ text: "SELECT (", name: "", types: [] }), serialize.flush()]));
    await a.until("error");
    b.socket.write(fullQuery(4));
    const pending = b.until("readyForQuery");
    await delay(20);
    a.socket.write(serialize.sync());
    await a.until("readyForQuery");
    const result = await pending;
    expect(errors(result)).toEqual([]);
    expect(columns(result)).toBe(4);
  });

  test("a client disconnecting between Parse and Sync releases waiting clients", async () => {
    const a = await wire(), b = await wire();
    a.socket.write(Buffer.concat([parseQuery(54), serialize.flush()]));
    await a.until("parseComplete");
    b.socket.write(fullQuery(4));
    const pending = b.until("readyForQuery");
    a.socket.destroy();
    const result = await pending;
    expect(errors(result)).toEqual([]);
    expect(columns(result)).toBe(4);
  });

  test("disconnecting after a Parse error recovers the protocol before resuming", async () => {
    const a = await wire(), b = await wire();
    a.socket.write(Buffer.concat([serialize.parse({ text: "SELECT (", name: "", types: [] }), serialize.flush()]));
    await a.until("error");
    b.socket.write(fullQuery(4));
    const pending = b.until("readyForQuery");
    await delay(20);
    a.socket.destroy();
    const result = await pending;
    expect(errors(result)).toEqual([]);
    expect(columns(result)).toBe(4);
  });

  test("disconnecting a transaction owner rolls back its writes", async () => {
    const a = await client(), b = await client();
    await a.query("CREATE TABLE IF NOT EXISTS qa_wire_disconnect(value integer)");
    await a.query("TRUNCATE qa_wire_disconnect");
    await a.query("BEGIN");
    await a.query("INSERT INTO qa_wire_disconnect VALUES($1)", [42]);
    const pending = b.query("SELECT count(*)::integer AS count FROM qa_wire_disconnect");
    await delay(20);
    await a.end(); clients.delete(a);
    expect((await pending).rows[0].count).toBe(0);
  });

  test("an execution exception cannot freeze the queue", async () => {
    const a = await wire(), b = await wire();
    const raw = database.execProtocolRawStream.bind(database);
    let fail = true;
    database.execProtocolRawStream = async (message, options) => {
      if (message[0] === 80 && fail) { fail = false; throw new Error("Isolated injected execution failure"); }
      return raw(message, options);
    };
    try {
      const closed = new Promise<void>(resolve => a.socket.once("close", () => resolve()));
      a.socket.write(fullQuery(4));
      await closed;
      b.socket.write(fullQuery(54));
      const result = await b.until("readyForQuery");
      expect(errors(result)).toEqual([]);
      expect(columns(result)).toBe(54);
    } finally { database.execProtocolRawStream = raw; }
  });
});
