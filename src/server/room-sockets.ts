import { randomUUID } from "node:crypto";
import { GUEST_COOKIE, findGuest } from "./sessions";
import { validOrigin } from "./security";
import { getStore } from "./atomic-store";
import { getRedis, redisKey, rateLimit } from "./redis";
import { commandRoom, getRoom, roomKey, roomReply, tickRoom, type RoomSession } from "./game-service";
import { roomNextDeadline } from "./game-engine";
import { roomCommandSchema, type GuestView } from "../shared/contracts";
import { disconnectIfAbsent, presenceIndex, presenceVersion, presenceSeen } from "./presence";

export type SocketData = { code: string; guest: GuestView; connectionId: string; presenceKey: string; version: number; nextRotation: number; nextPresence: number };
export interface RoomSocket { data: SocketData; readonly readyState: number; send(message: string): unknown; close(code: number, reason: string): void }

export async function authorizeRoomSocket(request: Request): Promise<SocketData | Response> {
  if (!validOrigin(request.headers.get("Origin"), request.url)) return new Response("Invalid origin", { status: 403 });
  const token = request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${GUEST_COOKIE}=`))?.slice(GUEST_COOKIE.length + 1);
  const guest = await findGuest(token);
  if (!guest) return new Response("Guest session required", { status: 401 });
  const code = (new URL(request.url).searchParams.get("room") || "").toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return new Response("Invalid room", { status: 400 });
  try { await getRoom(code, guest.id); } catch { return new Response("Join this room first", { status: 403 }); }
  const connectionId = randomUUID();
  return { code, guest, connectionId, presenceKey: redisKey(`presence:${code}:${guest.id}:${connectionId}`), version: 0, nextRotation: Date.now() + 240_000, nextPresence: 0 };
}

/** Both transports share Redis authority, membership checks, presence and deadlines. */
export class RoomSocketHub {
  private readonly connections = new Map<string, Set<RoomSocket>>();
  private readonly pending = new Set<string>();
  private readonly dirty = new Set<string>();
  private readonly watchedRooms = new Set<string>();
  private readonly pendingPresence = new Map<string, number>();
  private readonly nextRemoteCheck = new Map<string, number>();
  private readonly redis = getRedis();
  private readonly subscriber = this.redis.duplicate();
  private started: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;

  constructor() {
    this.subscriber.on("error", error => console.error("Room event connection:", error.message));
    this.subscriber.on("pmessage", (_pattern, channel) => {
      const code = channel.split(":").at(-1)!;
      if (!this.connections.has(code) && !this.watchedRooms.has(code)) return;
      this.watchedRooms.add(code);
      void this.broadcast(code);
    });
  }
  start(): Promise<void> {
    return this.started ??= this.subscriber.psubscribe(`${redisKey("state")}:events:room:*`).then(() => {
      this.timer = setInterval(() => void this.checkRooms(), 500);
      this.timer.unref();
    }).catch(error => { this.started = undefined; throw error; });
  }
  async open(socket: RoomSocket) {
    const { code, guest, presenceKey } = socket.data;
    return this.withPresenceChange(code, async () => {
      await this.start();
      this.watchedRooms.add(code);
      const registered = await this.redis.pipeline()
        .set(presenceKey, "1", "EX", 30).sadd(presenceIndex(code, guest.id), presenceKey)
        .incr(presenceVersion(code, guest.id)).set(presenceSeen(code, guest.id), Date.now(), "EX", 21600)
        .expire(presenceIndex(code, guest.id), 21600).expire(presenceVersion(code, guest.id), 21600).exec();
      if (registered?.some(([error]) => error)) throw new Error("Room presence unavailable");
      socket.data.nextPresence = Date.now() + 10_000;
      try {
        const reply = await commandRoom(code, guest, { id: randomUUID(), kind: "heartbeat" });
        if (socket.readyState !== 1) return;
        const set = this.connections.get(code) || new Set(); set.add(socket); this.connections.set(code, set);
        socket.data.version = reply.room.revision;
        socket.send(JSON.stringify({ type: "snapshot", ...reply }));
        await this.broadcast(code);
      } catch { socket.close(1008, "Room expired"); }
    });
  }
  async message(socket: RoomSocket, message: string) {
    try {
      if (!await rateLimit(`socket:${socket.data.guest.id}`, 100, 60)) throw new Error("Too many actions. Try again shortly.");
      const payload = JSON.parse(message);
      if (payload.type === "ping") {
        await this.refreshPresence(socket);
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "pong", serverNow: Date.now() }));
        return;
      }
      const command = roomCommandSchema.parse(payload);
      const reply = await commandRoom(socket.data.code, socket.data.guest, command);
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "ack", commandId: command.id, ...reply }));
    } catch (error) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Try again." }));
    }
  }
  async close(socket: RoomSocket) {
    const { code, guest, presenceKey } = socket.data;
    return this.withPresenceChange(code, async () => {
      this.connections.get(code)?.delete(socket);
      if (!this.connections.get(code)?.size) this.connections.delete(code);
      await this.redis.del(presenceKey);
      await this.redis.srem(presenceIndex(code, guest.id), presenceKey);
      await this.redis.incr(presenceVersion(code, guest.id));
      try { await disconnectIfAbsent(code, guest); } catch { /* The guest may have left or the room expired. */ }
    });
  }
  private async withPresenceChange(code: string, change: () => Promise<void>) {
    this.pendingPresence.set(code, (this.pendingPresence.get(code) || 0) + 1);
    try { await change(); }
    finally {
      const remaining = (this.pendingPresence.get(code) || 1) - 1;
      if (remaining) this.pendingPresence.set(code, remaining); else this.pendingPresence.delete(code);
    }
  }
  async stop() {
    clearInterval(this.timer);
    for (const sockets of this.connections.values()) for (const socket of sockets) socket.close(1001, "Server restarting");
    this.connections.clear(); this.watchedRooms.clear(); this.nextRemoteCheck.clear();
    this.subscriber.disconnect();
  }
  private async refreshPresence(socket: RoomSocket) {
    const refreshed = await this.redis.pipeline()
      .set(socket.data.presenceKey, "1", "EX", 30)
      .set(presenceSeen(socket.data.code, socket.data.guest.id), Date.now(), "EX", 21600).exec();
    if (refreshed?.some(([error]) => error)) throw new Error("Room presence unavailable");
    socket.data.nextPresence = Date.now() + 10_000;
  }
  private async broadcast(code: string) {
    if (this.pending.has(code)) { this.dirty.add(code); return; }
    this.pending.add(code);
    try {
      const stored = await getStore().load<RoomSession>(roomKey(code));
      if (!stored) return;
      for (const socket of this.connections.get(code) || []) {
        if (!stored.value.game.players.some(player => player.id === socket.data.guest.id && !player.left)) {
          socket.close(1008, "Join this room first"); continue;
        }
        if (socket.readyState !== 1 || stored.revision <= socket.data.version) continue;
        socket.data.version = stored.revision;
        socket.send(JSON.stringify({ type: "snapshot", ...roomReply(stored, socket.data.guest.id) }));
      }
    } catch (error) { console.error("Room broadcast:", error instanceof Error ? error.message : "failed"); }
    finally { this.pending.delete(code); if (this.dirty.delete(code)) void this.broadcast(code); }
  }
  private async checkRooms() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const code of this.watchedRooms) {
        try {
          const stored = await getStore().load<RoomSession>(roomKey(code));
          if (!stored) {
            for (const socket of this.connections.get(code) || []) socket.close(1008, "Room expired");
            this.watchedRooms.delete(code); this.nextRemoteCheck.delete(code); continue;
          }
          const localGuests = new Set<string>();
          for (const socket of this.connections.get(code) || []) {
            if (socket.readyState !== 1) continue;
            if (!stored.value.game.players.some(player => player.id === socket.data.guest.id && !player.left)) {
              socket.close(1008, "Join this room first"); continue;
            }
            localGuests.add(socket.data.guest.id);
            if (Date.now() >= socket.data.nextPresence) await this.refreshPresence(socket);
            if (Date.now() >= socket.data.nextRotation) {
              socket.send(JSON.stringify({ type: "rotate" })); socket.data.nextRotation = Date.now() + 240_000;
            }
          }
          if (stored.value.game.status === "complete") {
            if (!this.connections.has(code) && !this.pendingPresence.has(code)) { this.watchedRooms.delete(code); this.nextRemoteCheck.delete(code); }
            continue;
          }
          const deadline = roomNextDeadline(stored.value.game);
          if (deadline !== null && deadline <= Date.now()) await tickRoom(code);
          if (!this.connections.has(code) && !this.pendingPresence.has(code) && deadline === null) {
            this.watchedRooms.delete(code); this.nextRemoteCheck.delete(code); continue;
          }
          // Read other instances' last-seen values together; active local sockets need no Redis scan.
          if (Date.now() < (this.nextRemoteCheck.get(code) || 0)) continue;
          this.nextRemoteCheck.set(code, Date.now() + 2000);
          const remote = stored.value.game.players.filter(player => player.online && !player.left && !localGuests.has(player.id));
          if (!remote.length) continue;
          const seen = await this.redis.mget(...remote.map(player => presenceSeen(code, player.id)));
          await Promise.all(remote.filter((_player, index) => seen[index] && Date.now() - Number(seen[index]) >= 30_000).map(player => disconnectIfAbsent(code, player, true)));
        } catch (error) { console.error("Room timer:", error instanceof Error ? error.message : "failed"); }
      }
    } finally { this.checking = false; }
  }
}

let hub: RoomSocketHub | undefined;
export function getRoomSocketHub() { return hub ??= new RoomSocketHub(); }
