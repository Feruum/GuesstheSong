import { afterAll, describe, expect, test, spyOn } from "bun:test";
import { randomUUID } from "node:crypto";
import { createGuest } from "../src/server/sessions";
import { startSolo, getSolo, commandSolo, newRoom, commandRoom, getRoom, roomKey, matchmaking, cancelMatch, type SoloSession, type RoomSession } from "../src/server/game-service";
import { getStore } from "../src/server/atomic-store";
import { getPool } from "../src/server/db";
import { searchCatalog } from "../src/server/catalog";
import type { GuestView } from "../src/shared/contracts";

const guests: GuestView[] = [];
async function listener() { const guest = (await createGuest()).guest; guests.push(guest); return guest; }
afterAll(async () => { for (const guest of guests) { await getPool().query("DELETE FROM game_results WHERE guest_id=$1", [guest.id]); await getPool().query("DELETE FROM daily_entries WHERE guest_id=$1", [guest.id]); await getPool().query("DELETE FROM guests WHERE id=$1", [guest.id]); } });
describe("authoritative saved game service", () => {
  test("revoked public approval blocks cached and persisted Daily state and guesses", async () => {
    const guest = await listener();
    const keys = ["APP_URL", "DEEZER_PRIVATE_PREVIEWS", "DEEZER_PUBLIC_PREVIEWS_APPROVED", "DEEZER_PUBLIC_PREVIEWS_ORIGIN"] as const;
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    let id: string | undefined;
    try {
      Object.assign(process.env, { APP_URL: "https://music.example.com", DEEZER_PRIVATE_PREVIEWS: "false", DEEZER_PUBLIC_PREVIEWS_APPROVED: "true", DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com" });
      const preview = (await searchCatalog({ packId: "hits", limit: 1 }))[0];
      expect(preview).toBeTruthy();
      const { game } = await startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" });
      id = game.id;
      await getStore().update<SoloSession>(`solo:${id}`, value => ({ ...value, game: { ...value.game, tracks: [preview] } }));
      await getSolo(id, guest.id); // Persist only this test guest's own Daily state.
      process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED = "false";
      await expect(getSolo(id, guest.id)).rejects.toMatchObject({ code: "PRIVATE_PREVIEW_DISABLED" });
      await expect(commandSolo(id, guest.id, { id: randomUUID(), kind: "skip" })).rejects.toMatchObject({ code: "PRIVATE_PREVIEW_DISABLED" });
      await expect(startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" })).rejects.toMatchObject({ code: "PRIVATE_PREVIEW_DISABLED" });
      await getStore().remove(`solo:${id}`);
      await expect(startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" })).rejects.toMatchObject({ code: "PRIVATE_PREVIEW_DISABLED" });
    } finally {
      for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
      if (id) await getStore().remove(`solo:${id}`);
    }
  });
  test("Daily accepts wrong catalog guesses, resumes after Redis loss, and persists once", async () => {
    const guest = await listener();
    let { game } = await startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" });
    const stored = await getStore().load<SoloSession>(`solo:${game.id}`);
    const answer = stored!.value.game.tracks[0];
    const wrong = (await searchCatalog({ limit: 3 })).find(track => track.id !== answer.id)!;
    game = (await commandSolo(game.id, guest.id, { id: randomUUID(), kind: "guess", trackId: wrong.id })).game;
    expect(game.stageIndex).toBe(1);
    await getStore().remove(`solo:${game.id}`);
    game = (await startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" })).game;
    expect(game.stageIndex).toBe(1);
    const command = { id: randomUUID(), kind: "guess" as const, trackId: answer.id };
    game = (await commandSolo(game.id, guest.id, command)).game;
    expect(game.score).toBe(80);
    expect((await commandSolo(game.id, guest.id, command)).game.score).toBe(80);
    await commandSolo(game.id, guest.id, { id: randomUUID(), kind: "next" });
    await getSolo(game.id, guest.id);
    const rows = await getPool().query("SELECT score FROM game_results WHERE game_id=$1 AND guest_id=$2", [game.id, guest.id]);
    expect(rows.rows).toEqual([{ score: 80 }]);
    const saved = (await getPool().query("SELECT state FROM daily_entries WHERE guest_id=$1", [guest.id])).rows[0].state as SoloSession;
    expect(saved.game.status).toBe("complete");
    const stranger = await listener();
    await expect(getSolo(game.id, stranger.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await getStore().remove(`solo:${game.id}`);
  });
  test("simultaneous Duel answers award only one point across atomic updates", async () => {
    const first = await listener(), second = await listener();
    const { room } = await newRoom(first, { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    await commandRoom(room.code, second, { id: randomUUID(), kind: "join" });
    await commandRoom(room.code, first, { id: randomUUID(), kind: "ready", ready: true });
    await commandRoom(room.code, second, { id: randomUUID(), kind: "ready", ready: true });
    await commandRoom(room.code, first, { id: randomUUID(), kind: "start" });
    const stored = await getStore().load<RoomSession>(roomKey(room.code));
    const answerId = stored!.value.game.tracks[0].id;
    await Promise.allSettled([first, second].map(guest => commandRoom(room.code, guest, { id: randomUUID(), kind: "guess", trackId: answerId })));
    const updated = await getStore().load<RoomSession>(roomKey(room.code));
    expect(updated!.value.game.players.reduce((sum, player) => sum + player.score, 0)).toBe(1);
    expect(updated!.value.game.history[0].winnerIds.length).toBe(1);
    await getStore().remove(roomKey(room.code));
  });
  test("a leaving Duel opponent keeps a saved loss and rematches choose fresh answers", async () => {
    const first = await listener(), second = await listener();
    const { room } = await newRoom(first, { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } });
    await commandRoom(room.code, second, { id: randomUUID(), kind: "join" });
    await commandRoom(room.code, first, { id: randomUUID(), kind: "ready", ready: true }); await commandRoom(room.code, second, { id: randomUUID(), kind: "ready", ready: true });
    await commandRoom(room.code, first, { id: randomUUID(), kind: "start" });
    const old = (await getStore().load<RoomSession>(roomKey(room.code)))!;
    await commandRoom(room.code, second, { id: randomUUID(), kind: "leave" });
    expect((await getRoom(room.code, first.id)).room.players).toHaveLength(2);
    await expect(getRoom(room.code, second.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getPool().query("SELECT guest_id FROM game_results WHERE game_id=$1", [old.value.matchId])).rows.length).toBe(2);
    const rematchCommand = { id: randomUUID(), kind: "rematch" as const };
    await commandRoom(room.code, first, rematchCommand);
    const fresh = (await getStore().load<RoomSession>(roomKey(room.code)))!;
    expect(fresh.value.game.tracks[0].id).not.toBe(old.value.game.tracks[0].id);
    expect(fresh.value.matchId).not.toBe(old.value.matchId);
    await commandRoom(room.code, second, { id: randomUUID(), kind: "join" });
    await commandRoom(room.code, first, { id: randomUUID(), kind: "ready", ready: true });
    await commandRoom(room.code, second, { id: randomUUID(), kind: "ready", ready: true });
    await commandRoom(room.code, first, rematchCommand);
    const repeated = (await getStore().load<RoomSession>(roomKey(room.code)))!;
    expect(repeated.value.game.players.every(player => player.ready)).toBe(true);
    expect(repeated.value.game.tracks).toEqual(fresh.value.game.tracks);
    await commandRoom(room.code, first, { id: randomUUID(), kind: "start" });
    expect((await commandRoom(room.code, first, rematchCommand)).room.status).toBe("playing");
    await getStore().remove(roomKey(room.code));
  });
  test("matchmaking reserves each guest once and returns only fully joined rooms", async () => {
    const first = await listener(), second = await listener();
    expect((await matchmaking(first)).status).toBe("waiting");
    const matched = await matchmaking(second);
    expect(matched.status).toBe("matched");
    expect((await matchmaking(first)).code).toBe(matched.code);
    const state = (await getStore().load<RoomSession>(roomKey(matched.code!)))!;
    expect(state.value.game.players.map(player => player.id).sort()).toEqual([first.id, second.id].sort());
    await cancelMatch(first.id); await cancelMatch(second.id); await getStore().remove(roomKey(matched.code!));
  });
  test("cancelling a reserved match cannot resurrect its ticket or room", async () => {
    const first = await listener(), second = await listener();
    await matchmaking(first);
    const pool = getPool(); const original = pool.query.bind(pool);
    let reached!: () => void, resume!: () => void;
    const reserved = new Promise<void>(resolve => { reached = resolve; });
    const blocked = new Promise<void>(resolve => { resume = resolve; });
    const intercept = spyOn(pool, "query").mockImplementation((...args: unknown[]) => {
      if (args[0] === "SELECT id,nickname,avatar FROM guests WHERE id=$1") {
        reached(); return blocked.then(() => Reflect.apply(original, pool, args));
      }
      return Reflect.apply(original, pool, args);
    });
    try {
      const pending = matchmaking(second);
      await reserved; await cancelMatch(first.id); resume();
      expect((await pending).status).toBe("waiting");
      expect((await matchmaking(first)).status).toBe("waiting");
    } finally { resume(); intercept.mockRestore(); await cancelMatch(first.id); await cancelMatch(second.id); }
  });
});
