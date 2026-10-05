import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createGuest } from "../src/server/sessions";
import { getPool } from "../src/server/db";
import { getStore } from "../src/server/atomic-store";
import { commandRoom, newRoom, roomKey, type RoomSession } from "../src/server/game-service";
import type { GuestView } from "../src/shared/contracts";

const enabled = process.env.TEST_SOCKETS === "1";
const guests: GuestView[] = [];
const sockets: WebSocket[] = [];
const rooms: string[] = [];
afterAll(async () => { sockets.forEach(socket => socket.close()); for (const code of rooms) await getStore().remove(roomKey(code)); for (const guest of guests) { await getPool().query("DELETE FROM game_results WHERE guest_id=$1", [guest.id]); await getPool().query("DELETE FROM guests WHERE id=$1", [guest.id]); } });
function connect(port: number, code: string, token: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws?room=${code}`, { headers: { Cookie: `gts_guest=${token}`, Origin: "http://127.0.0.1:3000" } });
  sockets.push(socket);
  return socket;
}
async function snapshot(socket: WebSocket, predicate: (room: Record<string, unknown>) => boolean = () => true) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off("message", message); reject(new Error("Room snapshot timed out")); }, 10000);
    function message(data: WebSocket.RawData) { const payload = JSON.parse(data.toString()); if (payload.room && predicate(payload.room)) { clearTimeout(timeout); socket.off("message", message); resolve(payload.room); } }
    socket.on("message", message); socket.once("error", reject);
  });
}
describe.skipIf(!enabled)("live socket room integration", () => {
  test("24 players receive shared versions; cross-instance updates and reconnect resynchronize", async () => {
    const sessions = await Promise.all(Array.from({ length: 24 }, () => createGuest()));
    guests.push(...sessions.map(session => session.guest));
    const { room } = await newRoom(sessions[0].guest, { mode: "party", settings: { packId: "global-mix", rounds: 3, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    rooms.push(room.code);
    await Promise.all(sessions.slice(1).map(session => commandRoom(room.code, session.guest, { id: randomUUID(), kind: "join" })));
    const connected = sessions.map((session, index) => connect(index % 2 ? 3002 : 3001, room.code, session.token));
    const initial = await Promise.all(connected.map(socket => snapshot(socket)));
    expect(initial.every(value => (value.players as unknown[]).length === 24)).toBe(true);
    await Promise.all(sessions.map(session => commandRoom(room.code, session.guest, { id: randomUUID(), kind: "ready", ready: true })));
    const updates = connected.map(socket => snapshot(socket, value => value.status === "playing"));
    await commandRoom(room.code, sessions[0].guest, { id: randomUUID(), kind: "start" });
    const playing = await Promise.all(updates);
    expect(playing.every(value => value.round === 1 && value.audioUrl)).toBe(true);
    expect(playing.every(value => !JSON.stringify(value).includes("providerId"))).toBe(true);
    connected[0].terminate();
    await new Promise(resolve => setTimeout(resolve, 100));
    const resumed = await snapshot(connect(3002, room.code, sessions[0].token));
    expect(resumed.status).toBe("playing");
    expect((resumed.revision as number) >= (playing[0].revision as number)).toBe(true);
    const player = (resumed.players as (GuestView & { online: boolean })[]).find(player => player.id === sessions[0].guest.id)!;
    expect(player.online).toBe(true);
    sockets.forEach(socket => socket.close());
    await new Promise(resolve => setTimeout(resolve, 100));
    await getStore().remove(roomKey(room.code));
  }, 30000);
  test("socket access requires an authenticated member and valid origin", async () => {
    const session = await createGuest(); guests.push(session.guest);
    const { room } = await newRoom(session.guest, { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } }); rooms.push(room.code);
    const url = `http://127.0.0.1:3001/api/ws?room=${room.code}`;
    expect((await fetch(url, { headers: { Origin: "http://127.0.0.1:3000" } })).status).toBe(401);
    expect((await fetch(url, { headers: { Cookie: `gts_guest=${session.token}`, Origin: "https://other.invalid" } })).status).toBe(403);
    const stranger = await createGuest(); guests.push(stranger.guest);
    expect((await fetch(url, { headers: { Cookie: `gts_guest=${stranger.token}`, Origin: "http://127.0.0.1:3000" } })).status).toBe(403);
  });
  test("a surviving instance handles an abrupt host-server crash after 30 seconds", async () => {
    const child = Bun.spawn([process.execPath, "run", "--env-file=.env.local", "src/server/socket-server.ts"], { cwd: process.cwd(), env: { ...process.env, SOCKET_PORT: "0" }, stdout: "pipe", stderr: "pipe" });
    try {
      const startup = await child.stdout.getReader().read();
      const port = Number(new TextDecoder().decode(startup.value).match(/127\.0\.0\.1:(\d+)/)?.[1]);
      expect(port).toBeGreaterThan(0);
      const sessions = await Promise.all([createGuest(), createGuest()]); guests.push(...sessions.map(item => item.guest));
      const { room } = await newRoom(sessions[0].guest, { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } }); rooms.push(room.code);
      await commandRoom(room.code, sessions[1].guest, { id: randomUUID(), kind: "join" });
      await Promise.all([snapshot(connect(port, room.code, sessions[0].token)), snapshot(connect(3002, room.code, sessions[1].token))]);
      for (const session of sessions) await commandRoom(room.code, session.guest, { id: randomUUID(), kind: "ready", ready: true });
      await commandRoom(room.code, sessions[0].guest, { id: randomUUID(), kind: "start" });
      child.kill(9);
      await Promise.race([child.exited, Bun.sleep(1000)]);
      let listening = true;
      for (let i = 0; i < 20; i++) { try { await fetch(`http://127.0.0.1:${port}/api/ws`, { signal: AbortSignal.timeout(300) }); } catch { listening = false; break; } await Bun.sleep(100); }
      expect(listening).toBe(false);
      const started = Date.now(); let state: RoomSession | undefined;
      while (Date.now() - started < 38000) { state = (await getStore().load<RoomSession>(roomKey(room.code)))?.value; if (state?.game.status === "complete") break; await Bun.sleep(300); }
      expect(state?.game.status).toBe("complete"); expect(state?.game.completionReason).toBe("forfeit"); expect(state?.game.winnerIds).toEqual([sessions[1].guest.id]);
      expect(Date.now() - started).toBeLessThan(37000);
      const results = await getPool().query("SELECT guest_id FROM game_results WHERE game_id=$1", [state!.matchId]); expect(results.rows).toHaveLength(2);
    } finally { child.kill(); await Promise.race([child.exited, Bun.sleep(500)]); }
  }, 45000);
});
