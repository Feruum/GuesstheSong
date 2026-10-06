import { randomInt, randomUUID } from "node:crypto";
import { getStore, MissingStateError, type Stored } from "./atomic-store";
import { getPool } from "./db";
import { catalogTrack, selectPool } from "./catalog";
import { getRedis, redisKey } from "./redis";
import { makeAudioToken, stableDailyGameId, utcDate } from "./security";
import { createSoloGame, applySoloCommand, advanceSoloGame, publicSoloGame, currentSoloTrack, createRoom, applyRoomCommand, advanceRoom, publicRoom, currentRoomTrack, replaceRoomTracks, GameError, type SoloGameState, type RoomState } from "./game-engine";
import type { GuestView, SoloMode } from "../shared/contracts";
import type { z } from "zod";
import type { startGameSchema, soloCommandSchema, createRoomSchema, roomCommandSchema } from "../shared/contracts";
import { deezerPreviewsEnabled } from "./deezer";

export interface SoloSession { guestId: string; dailyDate: string | null; game: SoloGameState }
export interface RoomSession { matchId: string; game: RoomState }
const soloKey = (id: string) => `solo:${id}`;
export const roomKey = (code: string) => `room:${code.toUpperCase()}`;
function assertSoloSource(game: SoloGameState) {
  if (game.status !== "complete" && currentSoloTrack(game)?.id.startsWith("deezer-") && !deezerPreviewsEnabled()) {
    throw new GameError("PRIVATE_PREVIEW_DISABLED", "This game's music source is disabled. Your progress is saved. Choose an Audius collection or contact the site administrator.", 503);
  }
}
export async function startSolo(guest: GuestView, input: z.infer<typeof startGameSchema>) {
  const now = Date.now();
  let pool = await selectPool(input.packId, input.difficulty, { audiusOnly: input.mode === "chart" });
  let dailyDate: string | null = null;
  let id: string = randomUUID();
  if (input.mode === "daily") {
    dailyDate = utcDate(now);
    id = stableDailyGameId(dailyDate, guest.id);
    const existing = await getStore().load<SoloSession>(soloKey(id));
    if (existing) { assertSoloSource(existing.value.game); return soloReply(await advanceAndSaveSolo(existing, id), guest.id); }
    const saved = (await getPool().query("SELECT state,revision FROM daily_entries WHERE date=$1 AND guest_id=$2", [dailyDate, guest.id])).rows[0];
    if (saved) {
      assertSoloSource((saved.state as SoloSession).game);
      const restored = await getStore().create(soloKey(id), saved.state as SoloSession, 86400, saved.revision);
      return soloReply(restored, guest.id);
    }
    pool = await selectPool("global-mix");
    if (!pool.length) throw new GameError("EMPTY_CATALOG", "The daily song is not available yet. Add music to the catalog.", 503);
    await getPool().query("INSERT INTO daily_challenges(date,track_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [dailyDate, pool[0].id]);
    const challenge = (await getPool().query("SELECT track_id FROM daily_challenges WHERE date=$1", [dailyDate])).rows[0];
    const track = await catalogTrack(challenge.track_id);
    if (!track?.available) throw new GameError("AUDIO_UNAVAILABLE", "Today's song is unavailable from the music service. Your progress is saved.", 503);
    if (track.id.startsWith("deezer-") && !deezerPreviewsEnabled()) throw new GameError("PRIVATE_PREVIEW_DISABLED", "Today's song uses a disabled music source. Your progress is saved. Choose an Audius collection; a new Daily arrives at 00:00 UTC.", 503);
    pool = [track];
  }
  // Sample from the full catalog, but keep Redis state and atomic updates bounded.
  pool = pool.slice(0, input.mode === "classic" ? 10 : input.mode === "daily" ? 1 : 300);
  const game = createSoloGame({ id, playerId: guest.id, mode: input.mode, tracks: pool, now, packId: input.mode === "daily" ? "global-mix" : input.packId, difficulty: input.mode === "daily" ? 0 : input.difficulty, excerptMode: input.mode === "daily" ? "curated" : input.excerptMode });
  const stored = await getStore().create<SoloSession>(soloKey(id), { guestId: guest.id, dailyDate, game });
  await saveSolo(stored);
  return soloReply(stored, guest.id);
}
async function ownedSolo(id: string, guestId: string) {
  const stored = await getStore().load<SoloSession>(soloKey(id));
  if (!stored) throw new MissingStateError();
  if (stored.value.guestId !== guestId) throw new GameError("FORBIDDEN", "This game belongs to another listener.", 403);
  assertSoloSource(stored.value.game);
  return stored;
}
async function advanceAndSaveSolo(stored: Stored<SoloSession>, id: string) {
  const updated = await getStore().update<SoloSession>(soloKey(id), value => ({ ...value, game: advanceSoloGame(value.game, Date.now()) }));
  await saveSolo(updated);
  return updated;
}
export async function getSolo(id: string, guestId: string) { return soloReply(await advanceAndSaveSolo(await ownedSolo(id, guestId), id), guestId); }
export async function commandSolo(id: string, guestId: string, command: z.infer<typeof soloCommandSchema>) {
  await ownedSolo(id, guestId);
  const guessTrack = command.kind === "guess" && command.trackId ? await catalogTrack(command.trackId) : undefined;
  const stored = await getStore().update<SoloSession>(soloKey(id), value => ({ ...value, game: applySoloCommand(value.game, { ...command, guessTrack: guessTrack || undefined }, Math.max(Date.now(), value.game.updatedAt)) }));
  await saveSolo(stored);
  return soloReply(stored, guestId);
}
function soloReply(stored: Stored<SoloSession>, guestId: string) {
  assertSoloSource(stored.value.game);
  const view = publicSoloGame(stored.value.game, Date.now());
  const track = currentSoloTrack(stored.value.game);
  const audioUrl = track && view.status !== "complete" ? `/api/v1/audio/${makeAudioToken({ guestId, scope: "solo", targetId: view.id, trackIndex: stored.value.game.trackIndex })}` : null;
  return { game: { ...view, clipStartSec: 0, excerptStartSec: view.clipStartSec, audioUrl, revision: stored.revision, dailyDate: stored.value.dailyDate } };
}
async function saveSolo(stored: Stored<SoloSession>) {
  const { game, dailyDate, guestId } = stored.value;
  const view = publicSoloGame(game, Date.now());
  if (dailyDate) await getPool().query(`INSERT INTO daily_entries(date,guest_id,game_id,revision,state,solved,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(date,guest_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,solved=excluded.solved,completed_at=excluded.completed_at WHERE daily_entries.revision<excluded.revision`, [dailyDate, guestId, view.id, stored.revision, JSON.stringify(stored.value), view.history.some(item => item.solved), view.status === "complete" ? new Date() : null]);
  if (view.status === "complete") await getPool().query("INSERT INTO game_results(game_id,guest_id,mode,pack_id,difficulty,score,solved,summary) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING", [view.id, guestId, view.mode, view.packId, view.difficulty, view.score, view.history.some(item => item.solved), JSON.stringify({ rounds: view.history, dailyDate })]);
}
export async function newRoom(guest: GuestView, input: z.infer<typeof createRoomSchema>, forcedCode?: string) {
  const tracks = (await selectPool(input.settings.packId)).slice(0, input.mode === "duel" ? 7 : 30);
  let code = forcedCode || Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("");
  if (!forcedCode) while (await getStore().load(roomKey(code))) code = randomUUID().slice(0, 6).toUpperCase();
  const game = createRoom({ id: randomUUID(), code, mode: input.mode, host: guest, tracks, now: Date.now(), settings: input.settings });
  const stored = await getStore().create<RoomSession>(roomKey(code), { game, matchId: randomUUID() }, 21600);
  return roomReply(stored, guest.id);
}
async function ownedRoom(code: string, guestId: string, allowJoin = false) {
  const stored = await getStore().load<RoomSession>(roomKey(code));
  if (!stored) throw new MissingStateError();
  if (!allowJoin && !stored.value.game.players.some(player => player.id === guestId && !player.left)) throw new GameError("FORBIDDEN", "Join this room before opening it.", 403);
  return stored;
}
export async function getRoom(code: string, guestId: string) { await ownedRoom(code, guestId); return roomReply(await tickRoom(code), guestId); }
export async function tickRoom(code: string) {
  const stored = await getStore().update<RoomSession>(roomKey(code), value => ({ ...value, game: advanceRoom(value.game, Date.now()) }), 21600);
  await saveRoom(stored);
  return stored;
}
export async function commandRoom(code: string, guest: GuestView, command: z.infer<typeof roomCommandSchema> | { id: string; kind: "disconnect" }, presence?: { guard: { key: string; value: string }; disconnectedAt?: number }) {
  const existing = await ownedRoom(code, guest.id, command.kind === "join");
  const nextPack = command.kind === "settings" && "settings" in command && command.settings ? command.settings.packId : existing.value.game.settings.packId;
  let replacement = command.kind === "rematch" || nextPack !== existing.value.game.settings.packId ? await selectPool(nextPack) : null;
  if (replacement && command.kind === "rematch") {
    const revealed = new Set(existing.value.game.history.map(item => item.track.id));
    const fresh = replacement.filter(track => !revealed.has(track.id));
    if (fresh.length >= existing.value.game.totalRounds) replacement = fresh;
  }
  if (replacement) replacement = replacement.slice(0, existing.value.game.mode === "duel" ? 7 : 30);
  const guessTrack = command.kind === "guess" && "trackId" in command && command.trackId ? await catalogTrack(command.trackId) : undefined;
  const nextMatchId = randomUUID();
  const stored = await getStore().update<RoomSession>(roomKey(code), value => {
    const duplicate = value.game.processedCommandIds.includes(command.id);
    let game = applyRoomCommand(value.game, { ...command, playerId: guest.id, nickname: guest.nickname, avatar: guest.avatar, guessTrack: guessTrack || undefined }, Math.max(Date.now(), value.game.updatedAt));
    if (command.kind === "disconnect" && presence?.disconnectedAt && value.game.players.find(player => player.id === guest.id)?.online) {
      const player = game.players.find(player => player.id === guest.id);
      if (player) player.disconnectedAt = presence.disconnectedAt;
      game = advanceRoom(game, Math.max(Date.now(), game.updatedAt));
    }
    const rematched = !duplicate && command.kind === "rematch" && value.game.status === "complete" && game.status === "lobby";
    if (replacement && !duplicate && (rematched || value.game.settings.packId !== game.settings.packId)) game = replaceRoomTracks(game, replacement);
    return { game, matchId: rematched ? nextMatchId : value.matchId };
  }, 21600, presence?.guard);
  await saveRoom(stored);
  return roomReply(stored, guest.id);
}
export function roomReply(stored: Stored<RoomSession>, guestId: string) {
  const view = publicRoom(stored.value.game, guestId, Date.now());
  const track = currentRoomTrack(stored.value.game);
  const audioUrl = track && ["playing", "reveal"].includes(view.status) ? `/api/v1/audio/${makeAudioToken({ guestId, scope: "room", targetId: view.code, trackIndex: stored.value.game.trackIndex })}` : null;
  return { room: { ...view, clipStartSec: 0, excerptStartSec: view.clipStartSec, revision: stored.revision, audioUrl } };
}
async function saveRoom(stored: Stored<RoomSession>) {
  const view = publicRoom(stored.value.game, stored.value.game.hostId, Date.now());
  if (view.status !== "complete") return;
  const participants = stored.value.game.players.filter(player => player.inMatch).map(({ id, nickname, avatar, score, left }) => ({ id, nickname, avatar, score, left }));
  for (const player of participants) await getPool().query("INSERT INTO game_results(game_id,guest_id,mode,pack_id,difficulty,score,solved,summary) VALUES($1,$2,$3,$4,0,$5,$6,$7) ON CONFLICT DO NOTHING", [stored.value.matchId, player.id, view.mode, view.settings.packId, player.score, view.winnerIds.includes(player.id), JSON.stringify({ code: view.code, players: participants, rounds: view.history, winnerIds: view.winnerIds })]);
}
export async function audioTrack(scope: string, id: string, index: number, guestId: string) {
  if (scope === "room") {
    await ownedRoom(id, guestId);
    const stored = await tickRoom(id);
    if (stored.value.game.trackIndex !== index || !["playing", "reveal"].includes(stored.value.game.status)) return null;
    const track = currentRoomTrack(stored.value.game);
    const view = publicRoom(stored.value.game, guestId, Date.now());
    return track ? { ...track, clipStartSec: view.clipStartSec, clipDurationSec: view.clipDurationSec } : null;
  }
  const stored = await advanceAndSaveSolo(await ownedSolo(id, guestId), id);
  if (stored.value.game.trackIndex !== index || stored.value.game.status === "complete") return null;
  const view = publicSoloGame(stored.value.game, Date.now());
  return { ...currentSoloTrack(stored.value.game), clipStartSec: view.clipStartSec, clipDurationSec: view.clipDurationSec };
}
export async function guestStats(guestId: string) {
  const pool = getPool();
  const [summary, best, history, days] = await Promise.all([
    pool.query("SELECT count(*)::int AS games,coalesce(sum(score),0)::int AS points FROM game_results WHERE guest_id=$1", [guestId]),
    pool.query("SELECT mode,max(score)::int AS score,count(*)::int AS games FROM game_results WHERE guest_id=$1 GROUP BY mode", [guestId]),
    pool.query("SELECT game_id AS id,mode,score,pack_id AS \"packId\",completed_at AS \"completedAt\" FROM game_results WHERE guest_id=$1 ORDER BY completed_at DESC LIMIT 12", [guestId]),
    pool.query("SELECT date,solved FROM daily_entries WHERE guest_id=$1 AND completed_at IS NOT NULL ORDER BY date DESC", [guestId])
  ]);
  let streak = 0;
  const completed = new Set<string>(days.rows.filter(row => row.solved).map(row => row.date));
  let day = new Date(`${utcDate()}T00:00:00Z`);
  if (!completed.has(utcDate(day.getTime()))) day = new Date(day.getTime() - 86400000);
  while (completed.has(utcDate(day.getTime()))) { streak++; day = new Date(day.getTime() - 86400000); }
  return { ...summary.rows[0], streak, best: best.rows, history: history.rows, dailyHistory: days.rows.slice(0, 30) };
}
export async function leaderboard(mode: SoloMode, period: "all" | "week" | "today", packId?: string, difficulty?: number) {
  const values: unknown[] = [mode];
  const clauses = ["r.mode=$1"];
  if (period !== "all" || mode === "daily") { values.push(new Date(`${utcDate(Date.now() - (period === "week" && mode !== "daily" ? 6 : 0) * 86400000)}T00:00:00Z`)); clauses.push(`r.completed_at>=$${values.length}`); }
  if (packId) { values.push(packId); clauses.push(`r.pack_id=$${values.length}`); }
  if (difficulty !== undefined) { values.push(difficulty); clauses.push(`r.difficulty=$${values.length}`); }
  const rows = await getPool().query(`SELECT id,nickname,avatar,score,"completedAt" FROM (SELECT DISTINCT ON (g.id) g.id,g.nickname,g.avatar,r.score,r.completed_at AS "completedAt" FROM game_results r JOIN guests g ON g.id=r.guest_id WHERE ${clauses.join(" AND ")} ORDER BY g.id,r.score DESC,r.completed_at ASC) best ORDER BY score DESC,"completedAt" ASC LIMIT 50`, values);
  return rows.rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

const pairLua = `
local existing=redis.call('GET',KEYS[2]); if existing then return {existing,''} end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[2]);
local candidates=redis.call('ZRANGEBYSCORE',KEYS[1],ARGV[2],'+inf');
for _,other in ipairs(candidates) do
  if other~=ARGV[1] then
    redis.call('ZREM',KEYS[1],other); redis.call('ZREM',KEYS[1],ARGV[1]);
    redis.call('SET',KEYS[2],'pending:'..ARGV[3],'EX',120);
    redis.call('SET',ARGV[4]..other,'pending:'..ARGV[3],'EX',120);
    return {ARGV[3],other};
  end
end
redis.call('ZADD',KEYS[1],ARGV[5],ARGV[1]); redis.call('EXPIRE',KEYS[1],120); return {'',''};
`;
const publishMatchLua = `
if redis.call('GET',KEYS[1])==ARGV[1] and redis.call('GET',KEYS[2])==ARGV[1] then
  redis.call('SET',KEYS[1],ARGV[2],'EX',120); redis.call('SET',KEYS[2],ARGV[2],'EX',120); return 1;
end
for _,key in ipairs(KEYS) do if redis.call('GET',key)==ARGV[1] then redis.call('DEL',key) end end
return 0;
`;
const releaseMatchLua = `
for _,key in ipairs(KEYS) do if redis.call('GET',key)==ARGV[1] then redis.call('DEL',key) end end
return 1;
`;
export async function matchmaking(guest: GuestView) {
  const redis = getRedis();
  const code = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("");
  const [matched, other] = await redis.eval(pairLua, 2, redisKey("queue:duel"), redisKey(`match:${guest.id}`), guest.id, Date.now() - 30000, code, redisKey("match:"), Date.now()) as [string, string];
  if (matched.startsWith("pending:")) return { status: "waiting", code: null };
  if (other) {
    const reservation = `pending:${matched}`;
    const keys = [redisKey(`match:${guest.id}`), redisKey(`match:${other}`)];
    const rival = (await getPool().query("SELECT id,nickname,avatar FROM guests WHERE id=$1", [other])).rows[0] as GuestView | undefined;
    if (!rival) { await redis.eval(releaseMatchLua, 2, ...keys, reservation); throw new GameError("MATCH_EXPIRED", "That listener left the queue. Try again."); }
    try {
      await newRoom(rival, { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } }, matched);
      await commandRoom(matched, guest, { id: randomUUID(), kind: "join" });
      const published = await redis.eval(publishMatchLua, 2, ...keys, reservation, matched);
      if (published !== 1) { await getStore().remove(roomKey(matched)); return { status: "waiting", code: null }; }
    } catch (error) { await redis.eval(releaseMatchLua, 2, ...keys, reservation); await getStore().remove(roomKey(matched)); throw error; }
  }
  return { status: matched ? "matched" : "waiting", code: matched || null };
}
export async function cancelMatch(guestId: string) { await getRedis().eval("redis.call('ZREM',KEYS[1],ARGV[1]); redis.call('DEL',KEYS[2]); return 1", 2, redisKey("queue:duel"), redisKey(`match:${guestId}`), guestId); }
