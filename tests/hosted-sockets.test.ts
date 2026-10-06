import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { GET } from "../src/app/api/ws/route";
import { createGuest } from "../src/server/sessions";
import { getPool } from "../src/server/db";
import { getStore } from "../src/server/atomic-store";
import { newRoom, commandRoom, getRoom, roomKey } from "../src/server/game-service";
import { getRoomSocketHub } from "../src/server/room-sockets";
import { getRedis, redisKey } from "../src/server/redis";
import type { RoomSession } from "../src/server/game-service";

// Exercise the installed Vercel SDK against real HTTP upgrade sockets and real stores.
// This supplies only the runtime's documented low-level bridge, not a fake WebSocket.
const context = new AsyncLocalStorage<{ upgradeWebSocket: () => { req: IncomingMessage; socket: Socket; head: Buffer } }>();
const contextKey = Symbol.for("@vercel/request-context");
const globals = globalThis as unknown as Record<symbol, unknown>;
const previousContext = globals[contextKey];
const sessions: Awaited<ReturnType<typeof createGuest>>[] = [];
const roomCodes: string[] = [];
const sockets: WebSocket[] = [];
const origin = process.env.APP_URL || "http://127.0.0.1:3000";
let port = 0;
const pendingHandlers = new Set<Promise<unknown>>();
function webRequest(req: IncomingMessage) {
  return new Request(`http://127.0.0.1:${port}${req.url}`, { headers: { origin: req.headers.origin || "", cookie: req.headers.cookie || "", upgrade: req.headers.upgrade || "" } });
}
const server = createServer(async (req, res) => {
  const response = await GET(webRequest(req));
  res.writeHead(response.status); res.end(await response.text());
});
server.on("upgrade", (req, socket, head) => {
  const handled = context.run({ upgradeWebSocket: () => ({ req, socket: socket as Socket, head }) }, async () => {
    const response = await GET(webRequest(req));
    if (response.status !== 204 && !socket.destroyed) socket.end(`HTTP/1.1 ${response.status} Rejected\r\nConnection: close\r\n\r\n`);
  });
  pendingHandlers.add(handled);
  void handled.finally(() => pendingHandlers.delete(handled));
});
beforeAll(async () => {
  globals[contextKey] = { get: () => context.getStore() };
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  sockets.forEach(socket => socket.close());
  await Promise.allSettled([...pendingHandlers]);
  await getRoomSocketHub().stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
  if (previousContext === undefined) delete globals[contextKey]; else globals[contextKey] = previousContext;
  for (const code of roomCodes) await getStore().remove(roomKey(code));
  for (const session of sessions) {
    await getPool().query("DELETE FROM game_results WHERE guest_id=$1", [session.guest.id]);
    await getPool().query("DELETE FROM guests WHERE id=$1", [session.guest.id]);
  }
});
type Frame = { type: string; commandId?: string; room?: Awaited<ReturnType<typeof getRoom>>["room"] };
function connect(code: string, token: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws?room=${code}`, { headers: { Cookie: `gts_guest=${token}`, Origin: origin } });
  sockets.push(socket);
  const frames: Frame[] = [];
  socket.on("message", message => frames.push(JSON.parse(message.toString())));
  const closed = new Promise<{ code: number; reason: string }>(resolve => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  return { socket, frames, closed, async receive(predicate: (frame: Frame) => boolean) {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const index = frames.findIndex(predicate);
      if (index >= 0) return frames.splice(index, 1)[0];
      if (socket.readyState === WebSocket.CLOSED) throw new Error("Hosted socket closed before the expected update");
      await Bun.sleep(10);
    }
    throw new Error("Hosted socket update timed out");
  } };
}
async function session() { const value = await createGuest(); sessions.push(value); return value; }

describe("hosted Next.js socket adapter", () => {
  test("authenticates origin and room membership before a WebSocket upgrade", async () => {
    const host = await session(); const stranger = await session();
    const { room } = await newRoom(host.guest, { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    roomCodes.push(room.code);
    const url = `http://127.0.0.1:${port}/api/ws?room=${room.code}`;
    expect((await fetch(url, { headers: { Origin: origin } })).status).toBe(401);
    expect((await fetch(url, { headers: { Origin: "https://other.invalid", Cookie: `gts_guest=${host.token}` } })).status).toBe(403);
    expect((await fetch(url, { headers: { Origin: origin, Cookie: `gts_guest=${stranger.token}` } })).status).toBe(403);
    expect((await fetch(url, { headers: { Origin: origin, Cookie: `gts_guest=${host.token}` } })).status).toBe(426);
  });
  test("real SDK connections share snapshots, deduplicate commands and resynchronize on reconnect", async () => {
    const host = await session(); const other = await session();
    const { room } = await newRoom(host.guest, { mode: "party", settings: { packId: "global-mix", rounds: 3, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    roomCodes.push(room.code);
    await commandRoom(room.code, other.guest, { id: randomUUID(), kind: "join" });
    const first = connect(room.code, host.token); const second = connect(room.code, other.token);
    const initial = await Promise.all([first.receive(frame => frame.type === "snapshot"), second.receive(frame => frame.type === "snapshot")]);
    expect(initial.every(frame => frame.room?.players.length === 2)).toBe(true);
    const command = { id: randomUUID(), kind: "ready", ready: true };
    first.socket.send(JSON.stringify(command));
    const acknowledged = await first.receive(frame => frame.type === "ack" && frame.commandId === command.id);
    const changed = await second.receive(frame => !!frame.room?.players.find(player => player.id === host.guest.id)?.ready);
    expect(changed.room?.revision).toBe(acknowledged.room?.revision);
    first.socket.send(JSON.stringify(command));
    const repeated = await first.receive(frame => frame.type === "ack" && frame.commandId === command.id);
    expect(repeated.room?.players).toEqual(acknowledged.room?.players);
    const stored = await getStore().load<{ game: { processedCommandIds: string[] } }>(roomKey(room.code));
    expect(stored?.value.game.processedCommandIds.filter(id => id === command.id)).toHaveLength(1);
    await commandRoom(room.code, other.guest, { id: randomUUID(), kind: "ready", ready: true });
    await commandRoom(room.code, host.guest, { id: randomUUID(), kind: "start" });
    const playing = await second.receive(frame => frame.room?.status === "playing");
    expect(playing.room?.audioUrl).toBeString();
    expect(JSON.stringify(playing.room)).not.toContain("providerId");
    // Open the replacement before closing the old connection to exercise presence races.
    const replacement = connect(room.code, host.token);
    const resumed = await replacement.receive(frame => frame.room?.status === "playing");
    first.socket.terminate();
    await Bun.sleep(100);
    const current = await getRoom(room.code, host.guest.id);
    expect(current.room.players.find(player => player.id === host.guest.id)?.online).toBe(true);
    expect(resumed.room?.round).toBe(playing.room?.round);
    replacement.socket.send(JSON.stringify({ type: "ping" }));
    expect((await replacement.receive(frame => frame.type === "pong")).type).toBe("pong");
  }, 20000);
  test("leaving revokes an existing socket and abandoned lobbies stop polling", async () => {
    const host = await session(); const other = await session();
    const { room } = await newRoom(host.guest, { mode: "party", settings: { packId: "global-mix", rounds: 3, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    roomCodes.push(room.code);
    await commandRoom(room.code, other.guest, { id: randomUUID(), kind: "join" });
    const first = connect(room.code, host.token); const second = connect(room.code, other.token);
    await Promise.all([first.receive(frame => frame.type === "snapshot"), second.receive(frame => frame.type === "snapshot")]);
    await commandRoom(room.code, other.guest, { id: randomUUID(), kind: "leave" });
    const closed = await Promise.race([second.closed, Bun.sleep(2000).then(() => null)]);
    expect(closed?.code).toBe(1008);
    await commandRoom(room.code, host.guest, { id: randomUUID(), kind: "leave" });
    await Promise.race([first.closed, Bun.sleep(2000)]);
    await Bun.sleep(700);
    const store = getStore(); const original = store.load.bind(store); let loads = 0;
    store.load = async id => { if (id === roomKey(room.code)) loads++; return original(id); };
    try { await Bun.sleep(1100); expect(loads).toBe(0); } finally { store.load = original; }
  }, 10000);
  test("keeps a lobby's grace deadline when Redis disconnect cleanup is delayed", async () => {
    const host = await session(); const other = await session();
    const { room } = await newRoom(host.guest, { mode: "party", settings: { packId: "global-mix", rounds: 3, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    roomCodes.push(room.code);
    await commandRoom(room.code, other.guest, { id: randomUUID(), kind: "join" });
    const first = connect(room.code, host.token);
    await first.receive(frame => frame.type === "snapshot");
    const redis = getRedis(); const original = redis.del.bind(redis);
    let release = () => {}; const delayed = new Promise<void>(resolve => { release = resolve; });
    let entered = () => {}; const cleanupStarted = new Promise<void>(resolve => { entered = resolve; });
    redis.del = ((...args: Parameters<typeof redis.del>) => {
      if (String(args[0]).startsWith(redisKey(`presence:${room.code}:${host.guest.id}:`))) { entered(); return delayed.then(() => original(...args)); }
      return original(...args);
    }) as typeof redis.del;
    try {
      first.socket.close();
      await Promise.race([cleanupStarted, Bun.sleep(2000).then(() => { throw new Error("Disconnect cleanup did not start"); })]);
      await Bun.sleep(700);
      release(); await first.closed;
      // Let the actual disconnect commit, then accelerate only this test room's grace clock.
      const until = Date.now() + 2000;
      let disconnected = false;
      while (Date.now() < until) {
        const stored = await getStore().load<RoomSession>(roomKey(room.code));
        if (stored?.value.game.players.find(player => player.id === host.guest.id)?.online === false) { disconnected = true; break; }
        await Bun.sleep(10);
      }
      expect(disconnected).toBe(true);
      await getStore().update<RoomSession>(roomKey(room.code), value => {
        const next = structuredClone(value); const player = next.game.players.find(player => player.id === host.guest.id)!;
        player.disconnectedAt = Date.now() - 31000; return next;
      });
      await Bun.sleep(1000);
      const stored = await getStore().load<RoomSession>(roomKey(room.code));
      expect(stored?.value.game.hostId).toBe(other.guest.id);
    } finally { release(); redis.del = original; }
  }, 10000);
});
