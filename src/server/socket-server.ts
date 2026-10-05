import { randomUUID } from "node:crypto";
import type { ServerWebSocket } from "bun";
import { app } from "./api";
import { GUEST_COOKIE, findGuest } from "./sessions";
import { validOrigin } from "./security";
import { getStore } from "./atomic-store";
import { getRedis, redisKey, rateLimit } from "./redis";
import { commandRoom, getRoom, roomKey, roomReply, tickRoom, type RoomSession } from "./game-service";
import { roomNextDeadline } from "./game-engine";
import { roomCommandSchema, type GuestView } from "../shared/contracts";
import { disconnectIfAbsent, presenceIndex, presenceVersion, presenceSeen } from "./presence";

type SocketData = { code: string; guest: GuestView; connectionId: string; presenceKey: string; version: number; nextRotation: number };
const connections = new Map<string, Set<ServerWebSocket<SocketData>>>();
const pending = new Set<string>();
const dirty = new Set<string>();
const watchedRooms = new Set<string>();
const redis = getRedis();
const subscriber = redis.duplicate();
subscriber.on("error", error => console.error("Room event connection:", error.message));
await subscriber.psubscribe(`${redisKey("state")}:events:room:*`);
subscriber.on("pmessage", (_pattern, channel) => { const code = channel.split(":").at(-1)!; watchedRooms.add(code); void broadcast(code); });
async function broadcast(code: string) {
  if (pending.has(code)) { dirty.add(code); return; }
  pending.add(code);
  try {
    const stored = await getStore().load<RoomSession>(roomKey(code));
    if (!stored) return;
    for (const socket of connections.get(code) || []) {
      if (stored.revision <= socket.data.version) continue;
      socket.data.version = stored.revision;
      socket.send(JSON.stringify({ type: "snapshot", ...roomReply(stored, socket.data.guest.id) }));
    }
  } catch (error) { console.error("Room broadcast:", error instanceof Error ? error.message : "failed"); }
  finally { pending.delete(code); if (dirty.delete(code)) void broadcast(code); }
}
function cookie(request: Request, name: string) { return request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1); }
const port = Number(process.env.SOCKET_PORT || 3001);
const server = Bun.serve<SocketData>({
  port, hostname: "127.0.0.1", idleTimeout: 60,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ws") {
      if (!validOrigin(request.headers.get("Origin"), process.env.APP_URL || request.url)) return new Response("Invalid origin", { status: 403 });
      const guest = await findGuest(cookie(request, GUEST_COOKIE));
      if (!guest) return new Response("Guest session required", { status: 401 });
      const code = (url.searchParams.get("room") || "").toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(code)) return new Response("Invalid room", { status: 400 });
      try { await getRoom(code, guest.id); } catch { return new Response("Join this room first", { status: 403 }); }
      const connectionId = randomUUID();
      const upgraded = server.upgrade(request, { data: { code, guest, connectionId, presenceKey: redisKey(`presence:${code}:${guest.id}:${connectionId}`), version: 0, nextRotation: Date.now() + 240000 } });
      return upgraded ? undefined : new Response("Upgrade required", { status: 426 });
    }
    return app.fetch(request);
  },
  websocket: {
    maxPayloadLength: 65536,
    async open(socket) {
      const { code, guest, presenceKey } = socket.data;
      watchedRooms.add(code);
      await redis.set(presenceKey, "1", "EX", 30);
      await redis.sadd(presenceIndex(code, guest.id), presenceKey);
      await redis.incr(presenceVersion(code, guest.id));
      await redis.set(presenceSeen(code, guest.id), Date.now(), "EX", 21600);
      await redis.expire(presenceIndex(code, guest.id), 21600);
      await redis.expire(presenceVersion(code, guest.id), 21600);
      try {
        const reply = await commandRoom(code, guest, { id: randomUUID(), kind: "heartbeat" });
        if (socket.readyState !== 1) return;
        const set = connections.get(code) || new Set(); set.add(socket); connections.set(code, set);
        socket.data.version = reply.room.revision; socket.send(JSON.stringify({ type: "snapshot", ...reply }));
        await broadcast(code);
      }
      catch { socket.close(1008, "Room expired"); }
    },
    async message(socket, message) {
      try {
        if (!await rateLimit(`socket:${socket.data.guest.id}`, 100, 60)) throw new Error("Too many actions. Try again shortly.");
        const payload = JSON.parse(typeof message === "string" ? message : Buffer.from(message).toString());
        if (payload.type === "ping") { await redis.set(socket.data.presenceKey, "1", "EX", 30); socket.send(JSON.stringify({ type: "pong", serverNow: Date.now() })); return; }
        const command = roomCommandSchema.parse(payload);
        const reply = await commandRoom(socket.data.code, socket.data.guest, command);
        socket.send(JSON.stringify({ type: "ack", commandId: command.id, ...reply }));
      } catch (error) { socket.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Try again." })); }
    },
    async close(socket) {
      const { code, guest, presenceKey } = socket.data;
      connections.get(code)?.delete(socket);
      if (!connections.get(code)?.size) connections.delete(code);
      await redis.del(presenceKey);
      const indexKey = presenceIndex(code, guest.id);
      await redis.srem(indexKey, presenceKey);
      await redis.incr(presenceVersion(code, guest.id));
      try { await disconnectIfAbsent(code, guest); } catch { /* The guest may have left or the room expired. */ }
    },
  },
});
let checking = false;
setInterval(async () => {
  if (checking) return;
  checking = true;
  try {
  for (const code of watchedRooms) {
    try {
      const stored = await getStore().load<RoomSession>(roomKey(code));
      if (!stored || stored.value.game.status === "complete") { watchedRooms.delete(code); continue; }
      const deadline = stored && roomNextDeadline(stored.value.game);
      if (deadline !== null && deadline !== undefined && deadline <= Date.now()) await tickRoom(code);
      for (const socket of connections.get(code) || []) {
        await redis.set(socket.data.presenceKey, "1", "EX", 30);
        await redis.set(presenceSeen(code, socket.data.guest.id), Date.now(), "EX", 21600);
        if (Date.now() >= socket.data.nextRotation && stored?.value.game.status !== "lobby") {
          // Clients resynchronize periodically; no game state lives in the connection.
          socket.send(JSON.stringify({ type: "rotate" })); socket.data.nextRotation = Date.now() + 240000;
        }
      }
      await Promise.all(stored.value.game.players.filter(player => player.online && !player.left).map(player => disconnectIfAbsent(code, player, true)));
    } catch (error) { console.error("Room timer:", error instanceof Error ? error.message : "failed"); }
  }
  } finally { checking = false; }
}, 500).unref();
console.log(`Multiplayer server: http://127.0.0.1:${server.port}`);
