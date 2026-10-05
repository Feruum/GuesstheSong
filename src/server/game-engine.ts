import { CLIP_SCORES, CLIP_STAGES, type GuestView, type RoomMode, type SoloMode, type Track } from "../shared/contracts";

export type ExcerptMode = "curated" | "start";
export type SoloStatus = "playing" | "reveal" | "complete";
export type RoomStatus = "lobby" | "playing" | "reveal" | "complete";

export class GameError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = "GameError";
  }
}

export interface GameAttempt { label: string; correct: boolean }
export interface SoloHistoryEntry { track: Track; score: number; solved: boolean }
export interface ChartComparison { baseline: Track; challenger: Omit<Track, "playCount"> }
/** Trusted catalog metadata enriched by the server after validating a guessed ID. */
export type GuessTrack = Pick<Track, "id" | "title" | "artist" | "available">;

export interface CreateSoloGameInput {
  id: string;
  playerId: string;
  mode: SoloMode;
  tracks: readonly Track[];
  now: number;
  packId: string;
  difficulty?: number;
  excerptMode?: ExcerptMode;
}

export interface SoloCommand {
  id: string;
  kind: "guess" | "skip" | "next" | "chart";
  trackId?: string;
  guessTrack?: GuessTrack;
  choice?: "higher" | "lower";
}

/** Private persisted state. Never serialize this object to a player. */
export interface SoloGameState {
  id: string;
  playerId: string;
  mode: SoloMode;
  status: SoloStatus;
  packId: string;
  difficulty: number;
  excerptMode: ExcerptMode;
  tracks: Track[];
  trackIndex: number;
  baselineIndex: number | null;
  score: number;
  round: number;
  totalRounds: number;
  stageIndex: number;
  attempts: GameAttempt[];
  guessedTrackIds: string[];
  deadline: number | null;
  history: SoloHistoryEntry[];
  processedCommandIds: string[];
  expired: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SoloGameView {
  id: string;
  mode: SoloMode;
  status: SoloStatus;
  score: number;
  round: number;
  /** Zero denotes a clock or streak mode with no fixed number of rounds. */
  totalRounds: number;
  stageIndex: number;
  clipDurationSec: number;
  clipStartSec: number;
  attempts: GameAttempt[];
  deadline: number | null;
  serverNow: number;
  reveal: Track | null;
  history: SoloHistoryEntry[];
  comparison: ChartComparison | null;
  packId: string;
  difficulty: number;
  excerptMode: ExcerptMode;
}

export interface RoomSettings {
  packId: string;
  rounds: number;
  timeLimitSec: 30;
  startClipSec: 1;
  excerptMode: ExcerptMode;
}

export interface RoomPlayerState extends GuestView {
  ready: boolean;
  online: boolean;
  score: number;
  solved: boolean;
  gaveUp: boolean;
  left: boolean;
  inMatch: boolean;
  stageIndex: number;
  attempts: GameAttempt[];
  guessedTrackIds: string[];
  roundScore: number;
  disconnectedAt: number | null;
  disconnectHandled: boolean;
}

export interface RoomPlayerView extends GuestView {
  ready: boolean;
  online: boolean;
  score: number;
  solved: boolean;
}

export interface RoomRoundHistory {
  round: number;
  track: Track;
  score: number;
  solved: boolean;
  winnerIds: string[];
  playerResults: { playerId: string; score: number; solved: boolean }[];
}

/** Private persisted state. Track order and per-player guesses stay on the server. */
export interface RoomState {
  id: string;
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  hostId: string;
  settings: RoomSettings;
  tracks: Track[];
  trackIndex: number;
  players: RoomPlayerState[];
  round: number;
  totalRounds: number;
  roundStartedAt: number | null;
  deadline: number | null;
  history: RoomRoundHistory[];
  winnerIds: string[];
  completionReason: "finished" | "forfeit" | "abandoned" | null;
  processedCommandIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateRoomInput {
  id: string;
  code: string;
  mode: RoomMode;
  host: GuestView;
  tracks: readonly Track[];
  now: number;
  settings: RoomSettings;
}

export interface RoomCommand {
  id: string;
  playerId: string;
  kind: "join" | "ready" | "settings" | "start" | "guess" | "skip" | "leave" | "rematch" | "disconnect" | "heartbeat";
  nickname?: string;
  avatar?: number;
  ready?: boolean;
  trackId?: string;
  guessTrack?: GuessTrack;
  settings?: RoomSettings;
}

export interface RoomView {
  id: string;
  code: string;
  mode: RoomMode;
  status: RoomStatus;
  hostId: string;
  settings: RoomSettings;
  players: RoomPlayerView[];
  round: number;
  totalRounds: number;
  deadline: number | null;
  serverNow: number;
  stageIndex: number;
  clipDurationSec: number;
  clipStartSec: number;
  attempts: GameAttempt[];
  reveal: Track | null;
  history: RoomRoundHistory[];
  winnerIds: string[];
  selfId: string;
  completionReason: RoomState["completionReason"];
}

const BLITZ_DURATION_MS = 45_000;
const BLITZ_BONUS_MS = 10_000;
const ROOM_ROUND_MS = 30_000;
const REVEAL_DURATION_MS = 3_000;
const DISCONNECT_GRACE_MS = 30_000;
const LAST_STAGE = CLIP_STAGES.length - 1;

function validateTime(now: number, previous = 0): void {
  if (!Number.isFinite(now) || now < previous) {
    throw new GameError("INVALID_TIME", "Server time must move forward.", 400);
  }
}

function validateId(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new GameError("INVALID_COMMAND", label + " is required.", 400);
  }
}

function validateExcerptMode(value: ExcerptMode): void {
  if (value !== "curated" && value !== "start") {
    throw new GameError("INVALID_SETTINGS", "Choose a valid excerpt mode.", 400);
  }
}

function frozenPool(tracks: readonly Track[], minimum: number): Track[] {
  const distinct = new Map<string, Track>();
  for (const track of tracks) {
    if (!track.available || distinct.has(track.id)) continue;
    if (!track.id || !Number.isFinite(track.duration) || track.duration <= 0
      || !Number.isFinite(track.playCount) || track.playCount < 0
      || !Number.isFinite(track.clipStartSec) || track.clipStartSec < 0) {
      throw new GameError("INVALID_TRACKS", "The track pool contains invalid metadata.", 400);
    }
    distinct.set(track.id, { ...track });
  }
  const result = [...distinct.values()];
  if (result.length < minimum) {
    throw new GameError("INSUFFICIENT_TRACKS", "This mode needs at least " + minimum + " available songs.", 409);
  }
  return result;
}

function requirePoolSize(tracks: readonly Track[], minimum: number): void {
  if (tracks.filter(track => track.available).length < minimum) {
    throw new GameError("INSUFFICIENT_TRACKS", "This match needs at least " + minimum + " available songs.", 409);
  }
}

function trackLabel(track: Pick<Track, "title" | "artist">): string { return track.title + " — " + track.artist; }

function findGuess(tracks: readonly Track[], trackId: string | undefined, guessedTrackIds: readonly string[], guessTrack?: GuessTrack): GuessTrack {
  if (typeof trackId !== "string" || !trackId.trim()) {
    throw new GameError("INVALID_COMMAND", "Choose a song before guessing.", 400);
  }
  const track = guessTrack ?? tracks.find(candidate => candidate.id === trackId && candidate.available);
  if (!track || track.id !== trackId || !track.available) {
    throw new GameError("TRACK_NOT_FOUND", "That song could not be verified in the available catalog.", 404);
  }
  if (guessedTrackIds.includes(trackId)) {
    throw new GameError("DUPLICATE_GUESS", "You already guessed that song this round.", 409);
  }
  return track;
}

function excerptStart(track: Track, mode: ExcerptMode): number {
  if (mode === "start") return 0;
  // Longer stages extend the original excerpt without moving its start.
  return Math.min(track.clipStartSec, Math.max(0, track.duration - CLIP_STAGES[LAST_STAGE]));
}

function excerptDuration(track: Track, stageIndex: number, mode: ExcerptMode): number {
  return Math.min(CLIP_STAGES[stageIndex] ?? CLIP_STAGES[LAST_STAGE], track.duration - excerptStart(track, mode));
}

function soloAnswer(state: SoloGameState): Track {
  const track = state.tracks[state.trackIndex];
  if (!track) throw new GameError("INVALID_STATE", "This game no longer has an answer track.", 500);
  return track;
}

function nextComparableIndex(tracks: readonly Track[], baselineIndex: number, startIndex: number): number {
  const baseline = tracks[baselineIndex];
  for (let offset = 0; offset < tracks.length; offset++) {
    const index = (startIndex + offset) % tracks.length;
    if (tracks[index].playCount !== baseline.playCount) return index;
  }
  throw new GameError("NO_COMPARABLE_TRACKS", "Chart Clash needs songs with different play counts.", 409);
}

export function createSoloGame(input: CreateSoloGameInput): SoloGameState {
  if (!["classic", "daily", "blitz", "chart"].includes(input.mode)) {
    throw new GameError("INVALID_MODE", "Choose a solo game mode.", 400);
  }
  validateTime(input.now);
  validateId(input.id, "Game ID");
  validateId(input.playerId, "Player ID");
  validateId(input.packId, "Pack ID");
  const difficulty = input.difficulty ?? 0;
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 5) {
    throw new GameError("INVALID_SETTINGS", "Choose a difficulty from 0 to 5.", 400);
  }
  const excerptMode = input.excerptMode ?? "curated";
  validateExcerptMode(excerptMode);
  const tracks = frozenPool(input.tracks, input.mode === "classic" ? 10 : input.mode === "chart" ? 2 : 1);
  const baselineIndex = input.mode === "chart" ? 0 : null;
  const trackIndex = baselineIndex === null ? 0 : nextComparableIndex(tracks, baselineIndex, 1);
  return {
    id: input.id, playerId: input.playerId, mode: input.mode, status: "playing",
    packId: input.packId, difficulty, excerptMode, tracks, trackIndex, baselineIndex,
    score: 0, round: 1, totalRounds: input.mode === "classic" ? 10 : input.mode === "daily" ? 1 : 0,
    stageIndex: 0, attempts: [], guessedTrackIds: [],
    deadline: input.mode === "blitz" ? input.now + BLITZ_DURATION_MS : null,
    history: [], processedCommandIds: [], expired: false, createdAt: input.now, updatedAt: input.now,
  };
}

export function currentSoloTrack(state: SoloGameState): Track { return { ...soloAnswer(state) }; }

export function advanceSoloGame(state: SoloGameState, now: number): SoloGameState {
  validateTime(now, state.updatedAt);
  const next = structuredClone(state);
  if (next.mode === "blitz" && next.status === "playing" && next.deadline !== null && now >= next.deadline) {
    next.history.push({ track: { ...soloAnswer(next) }, score: 0, solved: false });
    next.status = "complete";
    next.deadline = null;
    next.expired = true;
  }
  next.updatedAt = now;
  return next;
}

function resetSoloRound(state: SoloGameState): void {
  state.stageIndex = 0;
  state.attempts = [];
  state.guessedTrackIds = [];
}

function soloHistory(state: SoloGameState, score: number, solved: boolean): void {
  state.history.push({ track: { ...soloAnswer(state) }, score, solved });
}

export function applySoloCommand(state: SoloGameState, command: SoloCommand, now: number): SoloGameState {
  validateId(command.id, "Command ID");
  const next = advanceSoloGame(state, now);
  if (next.processedCommandIds.includes(command.id)) return next;
  if (!["guess", "skip", "next", "chart"].includes(command.kind)) {
    throw new GameError("INVALID_COMMAND", "Choose a valid game action.", 400);
  }
  if (command.kind === "next") {
    if (next.mode === "blitz" || next.mode === "chart") {
      throw new GameError("INVALID_COMMAND", "This mode advances automatically.", 400);
    }
    if (next.status !== "reveal") throw new GameError("ROUND_NOT_REVEALED", "Finish this round before continuing.");
    if (next.round >= next.totalRounds) next.status = "complete";
    else {
      next.round++;
      next.trackIndex++;
      next.status = "playing";
      resetSoloRound(next);
    }
    next.processedCommandIds.push(command.id);
    return next;
  }
  if ((command.kind === "chart") !== (next.mode === "chart")) {
    throw new GameError("INVALID_COMMAND", "That action is not available in this mode.", 400);
  }
  if (next.status !== "playing") {
    throw new GameError(next.expired ? "GAME_EXPIRED" : "GAME_NOT_PLAYING", next.expired ? "The Blitz clock has expired." : "This round has already finished.");
  }
  if (next.mode === "chart") {
    if (command.choice !== "higher" && command.choice !== "lower") {
      throw new GameError("INVALID_COMMAND", "Choose higher or lower.", 400);
    }
    const baselineIndex = next.baselineIndex;
    if (baselineIndex === null) throw new GameError("INVALID_STATE", "Chart Clash is missing its baseline.", 500);
    const challenger = soloAnswer(next);
    const correct = command.choice === (challenger.playCount > next.tracks[baselineIndex].playCount ? "higher" : "lower");
    next.attempts.push({ label: command.choice === "higher" ? "Higher" : "Lower", correct });
    soloHistory(next, correct ? 1 : 0, correct);
    if (correct) {
      next.score++;
      next.baselineIndex = next.trackIndex;
      next.trackIndex = nextComparableIndex(next.tracks, next.baselineIndex, next.trackIndex + 1);
      next.round++;
      resetSoloRound(next);
    } else next.status = "complete";
    next.processedCommandIds.push(command.id);
    return next;
  }
  const guess = command.kind === "guess" ? findGuess(next.tracks, command.trackId, next.guessedTrackIds, command.guessTrack) : null;
  const correct = guess?.id === soloAnswer(next).id;
  if (guess) next.guessedTrackIds.push(guess.id);
  next.attempts.push({ label: guess ? trackLabel(guess) : "Skipped", correct });
  if (next.mode === "blitz") {
    soloHistory(next, correct ? 1 : 0, correct);
    if (correct) {
      next.score++;
      if (next.deadline !== null) next.deadline += BLITZ_BONUS_MS;
    }
    next.round++;
    next.trackIndex = (next.trackIndex + 1) % next.tracks.length;
    resetSoloRound(next);
  } else if (correct) {
    const score = CLIP_SCORES[next.stageIndex];
    next.score += score;
    soloHistory(next, score, true);
    next.status = "reveal";
  } else if (next.stageIndex === LAST_STAGE) {
    soloHistory(next, 0, false);
    next.status = "reveal";
  } else next.stageIndex++;
  next.processedCommandIds.push(command.id);
  return next;
}

export function publicSoloGame(state: SoloGameState, now: number): SoloGameView {
  const current = advanceSoloGame(state, now);
  const answer = soloAnswer(current);
  let comparison: ChartComparison | null = null;
  if (current.mode === "chart" && current.baselineIndex !== null) {
    const challenger = Object.fromEntries(Object.entries(answer).filter(([key]) => key !== "playCount")) as Omit<Track, "playCount">;
    comparison = { baseline: { ...current.tracks[current.baselineIndex] }, challenger };
  }
  return {
    id: current.id, mode: current.mode, status: current.status, score: current.score,
    round: current.round, totalRounds: current.totalRounds, stageIndex: current.stageIndex,
    clipDurationSec: excerptDuration(answer, current.mode === "blitz" ? LAST_STAGE : current.stageIndex, current.excerptMode),
    clipStartSec: excerptStart(answer, current.excerptMode), attempts: current.attempts,
    deadline: current.deadline, serverNow: now, reveal: current.status === "playing" ? null : { ...answer },
    history: current.history, comparison, packId: current.packId, difficulty: current.difficulty, excerptMode: current.excerptMode,
  };
}

function normalizeSettings(settings: RoomSettings, mode: RoomMode): RoomSettings {
  if (!settings || !Number.isInteger(settings.rounds) || settings.rounds < 3 || settings.rounds > 30
    || settings.timeLimitSec !== 30 || settings.startClipSec !== 1) {
    throw new GameError("INVALID_SETTINGS", "Rooms use 3–30 rounds, 30 seconds, and a one-second starting clip.", 400);
  }
  validateId(settings.packId, "Pack ID");
  validateExcerptMode(settings.excerptMode);
  return { ...settings, rounds: mode === "duel" ? 7 : settings.rounds };
}

function validateGuest(guest: GuestView): GuestView {
  validateId(guest.id, "Player ID");
  if (typeof guest.nickname !== "string") throw new GameError("INVALID_NICKNAME", "Choose a nickname.", 400);
  const nickname = guest.nickname.trim();
  if (nickname.length < 2 || nickname.length > 24 || !/^[\p{L}\p{N} ._\-]+$/u.test(nickname)) {
    throw new GameError("INVALID_NICKNAME", "Use a nickname with 2–24 letters, numbers, or simple punctuation.", 400);
  }
  if (!Number.isInteger(guest.avatar) || guest.avatar < 0 || guest.avatar > 7) {
    throw new GameError("INVALID_AVATAR", "Choose a valid avatar.", 400);
  }
  return { ...guest, nickname };
}

function roomPlayer(guest: GuestView): RoomPlayerState {
  return {
    ...validateGuest(guest), ready: false, online: true, score: 0, solved: false,
    gaveUp: false, left: false, inMatch: false, stageIndex: 0, attempts: [],
    guessedTrackIds: [], roundScore: 0, disconnectedAt: null, disconnectHandled: false,
  };
}

export function createRoom(input: CreateRoomInput): RoomState {
  if (input.mode !== "party" && input.mode !== "duel") {
    throw new GameError("INVALID_MODE", "Choose Party or Duel.", 400);
  }
  validateTime(input.now);
  validateId(input.id, "Room ID");
  validateId(input.code, "Room code");
  const settings = normalizeSettings(input.settings, input.mode);
  return {
    id: input.id, code: input.code.toUpperCase(), mode: input.mode, status: "lobby",
    hostId: input.host.id, settings, tracks: frozenPool(input.tracks, settings.rounds),
    trackIndex: 0, players: [roomPlayer(input.host)], round: 0, totalRounds: settings.rounds,
    roundStartedAt: null, deadline: null, history: [], winnerIds: [], completionReason: null,
    processedCommandIds: [], createdAt: input.now, updatedAt: input.now,
  };
}

function roomAnswer(state: RoomState): Track | null { return state.round > 0 ? state.tracks[state.trackIndex] ?? null : null; }

export function currentRoomTrack(state: RoomState): Track | null {
  if (state.status !== "playing" && state.status !== "reveal") return null;
  const answer = roomAnswer(state);
  return answer ? { ...answer } : null;
}

export function replaceRoomTracks(state: RoomState, tracks: readonly Track[]): RoomState {
  if (state.status !== "lobby") throw new GameError("LOBBY_ONLY", "Change the pack while everyone is in the lobby.");
  const next = structuredClone(state);
  next.tracks = frozenPool(tracks, next.totalRounds);
  next.trackIndex = 0;
  for (const player of next.players) player.ready = false;
  return next;
}

export function roomNextDeadline(state: RoomState): number | null {
  let deadline = state.deadline;
  for (const player of state.players) {
    if (player.left || player.online || player.disconnectHandled || player.disconnectedAt === null) continue;
    const graceEnd = player.disconnectedAt + DISCONNECT_GRACE_MS;
    if (deadline === null || graceEnd < deadline) deadline = graceEnd;
  }
  return deadline;
}

function startRoomRound(state: RoomState, round: number, now: number): void {
  state.status = "playing";
  state.round = round;
  state.trackIndex = (round - 1) % state.tracks.length;
  state.roundStartedAt = now;
  state.deadline = now + ROOM_ROUND_MS;
  for (const player of state.players) {
    player.solved = false;
    player.gaveUp = player.left;
    player.stageIndex = 0;
    player.attempts = [];
    player.guessedTrackIds = [];
    player.roundScore = 0;
  }
}

function roundFinished(state: RoomState): boolean {
  const participants = state.players.filter(player => player.inMatch);
  return participants.length > 0 && participants.every(player => player.left || player.solved || player.gaveUp || (!player.online && player.disconnectHandled));
}

function finishRoomRound(state: RoomState, now: number): void {
  if (state.status !== "playing") return;
  const track = roomAnswer(state);
  if (!track) throw new GameError("INVALID_STATE", "This room no longer has an answer track.", 500);
  const participants = state.players.filter(player => player.inMatch);
  const roundBest = Math.max(0, ...participants.map(player => player.roundScore));
  state.history.push({
    round: state.round, track: { ...track },
    score: participants.reduce((total, player) => total + player.roundScore, 0),
    solved: participants.some(player => player.solved),
    winnerIds: roundBest === 0 ? [] : participants.filter(player => player.roundScore === roundBest).map(player => player.id),
    playerResults: participants.map(player => ({ playerId: player.id, score: player.roundScore, solved: player.solved })),
  });
  state.status = "reveal";
  state.deadline = now + REVEAL_DURATION_MS;
}

function matchWinners(state: RoomState): string[] {
  const participants = state.players.filter(player => player.inMatch && !player.left);
  if (!participants.length) return [];
  const best = Math.max(...participants.map(player => player.score));
  return participants.filter(player => player.score === best).map(player => player.id);
}

function finishRoomMatch(state: RoomState, reason: "finished" | "forfeit" | "abandoned", now: number, winnerId?: string): void {
  if (state.status === "complete") return;
  if (state.status === "playing") finishRoomRound(state, now);
  state.status = "complete";
  state.deadline = null;
  state.completionReason = reason;
  state.winnerIds = reason === "forfeit" && winnerId ? [winnerId] : reason === "abandoned" ? [] : matchWinners(state);
}

function transferHost(state: RoomState): void {
  const current = state.players.find(player => player.id === state.hostId && !player.left);
  if (current && (current.online || !current.disconnectHandled)) return;
  const present = state.players.filter(player => !player.left);
  const replacement = present.find(player => player.online);
  if (replacement) state.hostId = replacement.id;
  else if (!current) state.hostId = present[0]?.id ?? "";
}

function reconcileRoom(state: RoomState, now: number): void {
  transferHost(state);
  if (state.status === "complete") return;
  const playing = state.status === "playing" || state.status === "reveal";
  const participants = state.players.filter(player => !player.left && (!playing || player.inMatch));
  if (!participants.length || participants.every(player => !player.online && player.disconnectHandled)) {
    finishRoomMatch(state, "abandoned", now);
    return;
  }
  if (state.mode === "duel" && playing) {
    if (participants.length === 1) {
      finishRoomMatch(state, "forfeit", now, participants[0].id);
      return;
    }
    const expired = participants.find(player => !player.online && player.disconnectHandled);
    const opponent = expired && participants.find(player => player.id !== expired.id && player.online);
    if (opponent) {
      finishRoomMatch(state, "forfeit", now, opponent.id);
      return;
    }
  }
  if (state.status === "playing" && roundFinished(state)) finishRoomRound(state, now);
}

export function advanceRoom(state: RoomState, now: number): RoomState {
  validateTime(now, state.updatedAt);
  const next = structuredClone(state);
  // Process events at their original times, including missed reveals and rounds.
  for (;;) {
    const eventTime = roomNextDeadline(next);
    if (eventTime === null || eventTime > now) break;
    for (const player of next.players) {
      if (!player.left && !player.online && !player.disconnectHandled && player.disconnectedAt !== null
        && player.disconnectedAt + DISCONNECT_GRACE_MS <= eventTime) {
        player.disconnectHandled = true;
      }
    }
    reconcileRoom(next, eventTime);
    if (next.deadline !== null && next.deadline <= eventTime) {
      if (next.status === "playing") finishRoomRound(next, eventTime);
      else if (next.status === "reveal") {
        if (next.round >= next.totalRounds) finishRoomMatch(next, "finished", eventTime);
        else startRoomRound(next, next.round + 1, eventTime);
      } else next.deadline = null;
    }
    reconcileRoom(next, eventTime);
  }
  reconcileRoom(next, now);
  next.updatedAt = now;
  return next;
}

function connectedPlayer(player: RoomPlayerState): void {
  player.online = true;
  player.disconnectedAt = null;
  player.disconnectHandled = false;
}

function requireHost(state: RoomState, playerId: string): void {
  if (state.hostId !== playerId) throw new GameError("FORBIDDEN", "Only the host can do that.", 403);
}

function requireLobby(state: RoomState): void {
  if (state.status !== "lobby") throw new GameError("LOBBY_ONLY", "Return to the lobby before doing that.");
}

function roomJoin(state: RoomState, command: RoomCommand): void {
  const existing = state.players.find(player => player.id === command.playerId && !player.left);
  if (existing) {
    const updated = validateGuest({
      id: existing.id, nickname: command.nickname ?? existing.nickname, avatar: command.avatar ?? existing.avatar,
    });
    existing.nickname = updated.nickname;
    existing.avatar = updated.avatar;
    connectedPlayer(existing);
    return;
  }
  if (state.status !== "lobby") throw new GameError("ROOM_ALREADY_STARTED", "This room has already started.");
  const maximum = state.mode === "duel" ? 2 : 24;
  if (state.players.filter(player => !player.left).length >= maximum) throw new GameError("ROOM_FULL", "This room is full.");
  state.players = state.players.filter(player => player.id !== command.playerId);
  state.players.push(roomPlayer({ id: command.playerId, nickname: command.nickname ?? "", avatar: command.avatar ?? 0 }));
}

export function applyRoomCommand(state: RoomState, command: RoomCommand, now: number): RoomState {
  validateId(command.id, "Command ID");
  validateId(command.playerId, "Player ID");
  const next = advanceRoom(state, now);
  if (next.processedCommandIds.includes(command.id)) return next;
  if (command.kind === "join") {
    roomJoin(next, command);
    next.processedCommandIds.push(command.id);
    reconcileRoom(next, now);
    return next;
  }
  const player = next.players.find(candidate => candidate.id === command.playerId && !candidate.left);
  if (!player) throw new GameError("NOT_IN_ROOM", "Join this room before playing.", 403);
  switch (command.kind) {
    case "disconnect":
      if (player.online) {
        player.online = false;
        player.disconnectedAt = now;
        player.disconnectHandled = false;
        if (next.status === "lobby") player.ready = false;
      }
      break;
    case "heartbeat":
      connectedPlayer(player);
      break;
    case "leave":
      if (next.status === "lobby") next.players = next.players.filter(candidate => candidate.id !== player.id);
      else {
        player.left = true;
        player.online = false;
        player.ready = false;
        player.gaveUp = true;
        player.disconnectedAt = now;
        player.disconnectHandled = true;
      }
      transferHost(next);
      break;
    case "ready":
      requireLobby(next);
      if (typeof command.ready !== "boolean") throw new GameError("INVALID_COMMAND", "Choose whether you are ready.", 400);
      connectedPlayer(player);
      player.ready = command.ready;
      break;
    case "settings":
      requireHost(next, player.id);
      requireLobby(next);
      if (!command.settings) throw new GameError("INVALID_SETTINGS", "Room settings are required.", 400);
      next.settings = normalizeSettings(command.settings, next.mode);
      next.totalRounds = next.settings.rounds;
      for (const member of next.players) member.ready = false;
      connectedPlayer(player);
      break;
    case "start": {
      requireHost(next, player.id);
      requireLobby(next);
      connectedPlayer(player);
      const participants = next.players.filter(member => !member.left && member.online);
      if (participants.length < 2) throw new GameError("NOT_ENOUGH_PLAYERS", "At least two players must be online to start.");
      if (participants.some(member => !member.ready)) throw new GameError("NOT_READY", "Every player must be ready to start.");
      requirePoolSize(next.tracks, next.totalRounds);
      next.history = [];
      next.winnerIds = [];
      next.completionReason = null;
      for (const member of next.players) {
        member.inMatch = !member.left && member.online;
        member.score = 0;
      }
      startRoomRound(next, 1, now);
      break;
    }
    case "guess":
    case "skip": {
      if (next.status !== "playing") throw new GameError("GAME_NOT_PLAYING", "Wait until the next round starts.");
      if (!player.inMatch) throw new GameError("NOT_PARTICIPANT", "Join the next match to play.", 403);
      if (player.solved || player.gaveUp) throw new GameError("ALREADY_FINISHED", "You have finished this round.");
      const guess = command.kind === "guess" ? findGuess(next.tracks, command.trackId, player.guessedTrackIds, command.guessTrack) : null;
      const correct = guess?.id === roomAnswer(next)?.id;
      connectedPlayer(player);
      if (guess) player.guessedTrackIds.push(guess.id);
      player.attempts.push({ label: guess ? trackLabel(guess) : "Skipped", correct });
      if (correct) {
        player.solved = true;
        const remaining = Math.max(0, Math.min(ROOM_ROUND_MS, (next.deadline ?? now) - now));
        player.roundScore = next.mode === "duel" ? 1 : 100 + Math.floor(900 * remaining / ROOM_ROUND_MS);
        player.score += player.roundScore;
        if (next.mode === "duel") finishRoomRound(next, now);
      } else if (player.stageIndex === LAST_STAGE) player.gaveUp = true;
      else player.stageIndex++;
      break;
    }
    case "rematch":
      requireHost(next, player.id);
      if (next.status !== "complete") throw new GameError("MATCH_NOT_COMPLETE", "Finish the match before starting a rematch.");
      connectedPlayer(player);
      next.players = next.players.filter(member => !member.left);
      for (const member of next.players) {
        member.ready = false;
        member.score = 0;
        member.solved = false;
        member.gaveUp = false;
        member.inMatch = false;
        member.stageIndex = 0;
        member.attempts = [];
        member.guessedTrackIds = [];
        member.roundScore = 0;
      }
      next.status = "lobby";
      next.round = 0;
      next.trackIndex = 0;
      next.roundStartedAt = null;
      next.deadline = null;
      next.history = [];
      next.winnerIds = [];
      next.completionReason = null;
      break;
    default:
      throw new GameError("INVALID_COMMAND", "Choose a valid room action.", 400);
  }
  next.processedCommandIds.push(command.id);
  reconcileRoom(next, now);
  return next;
}

export function publicRoom(state: RoomState, viewerId: string, now: number): RoomView {
  const current = advanceRoom(state, now);
  const viewer = current.players.find(player => player.id === viewerId && !player.left);
  const answer = roomAnswer(current);
  const stageIndex = viewer?.stageIndex ?? 0;
  return {
    id: current.id, code: current.code, mode: current.mode, status: current.status, hostId: current.hostId,
    settings: current.settings,
    players: current.players.filter(player => !player.left).map(player => ({
      id: player.id, nickname: player.nickname, avatar: player.avatar,
      ready: player.ready, online: player.online, score: player.score, solved: player.solved,
    })),
    round: current.round, totalRounds: current.totalRounds, deadline: current.deadline, serverNow: now,
    stageIndex, clipDurationSec: answer ? excerptDuration(answer, stageIndex, current.settings.excerptMode) : CLIP_STAGES[0],
    clipStartSec: answer ? excerptStart(answer, current.settings.excerptMode) : 0,
    attempts: viewer?.attempts ?? [],
    reveal: answer && (current.status === "reveal" || current.status === "complete") ? { ...answer } : null,
    history: current.history, winnerIds: current.winnerIds, selfId: viewerId, completionReason: current.completionReason,
  };
}
