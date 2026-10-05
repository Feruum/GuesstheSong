import { describe, expect, test } from "bun:test";
import type { GuestView, SoloMode, Track } from "../src/shared/contracts";
import { CLIP_SCORES, CLIP_STAGES } from "../src/shared/contracts";
import {
  GameError,
  advanceRoom,
  advanceSoloGame,
  applyRoomCommand,
  applySoloCommand,
  createRoom,
  createSoloGame,
  currentRoomTrack,
  currentSoloTrack,
  publicRoom,
  publicSoloGame,
  replaceRoomTracks,
  roomNextDeadline,
  type RoomState,
} from "../src/server/game-engine";

let sequence = 0;
const commandId = () => `command-${++sequence}`;
const host: GuestView = { id: "host", nickname: "Host", avatar: 0 };
const guest: GuestView = { id: "guest", nickname: "Guest", avatar: 1 };
const settings = { packId: "test-pack", rounds: 3, timeLimitSec: 30 as const, startClipSec: 1 as const, excerptMode: "curated" as const };

function tracks(count = 30): Track[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `track-${index}`,
    providerId: `provider-${index}`,
    title: `Secret title ${index}`,
    artist: `Secret artist ${index}`,
    artworkUrl: `https://example.test/art-${index}.jpg`,
    duration: 180,
    genre: "Electronic",
    releaseYear: 2024,
    language: "English",
    playCount: 1_234_567 + index * 100,
    clipStartSec: 42,
    sourceUrl: `https://example.test/song-${index}`,
    license: "CC-BY",
    available: true,
  }));
}

function solo(mode: SoloMode = "classic", pool = tracks()) {
  return createSoloGame({ id: "solo-game", playerId: host.id, mode, tracks: pool, now: 0, packId: "test-pack" });
}

function room(mode: "party" | "duel" = "party") {
  return createRoom({ id: "room-id", code: "ABC123", mode, host, tracks: tracks(), now: 0, settings });
}

function join(state: RoomState, player: GuestView = guest, now = 0) {
  return applyRoomCommand(state, { id: commandId(), playerId: player.id, kind: "join", nickname: player.nickname, avatar: player.avatar }, now);
}

function ready(state: RoomState, playerId: string, now = 0) {
  return applyRoomCommand(state, { id: commandId(), playerId, kind: "ready", ready: true }, now);
}

function startedRoom(mode: "party" | "duel" = "party") {
  let state = join(room(mode));
  state = ready(state, host.id);
  state = ready(state, guest.id);
  return applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "start" }, 0);
}

function expectGameError(action: () => unknown, code: string) {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(GameError);
  if (caught instanceof GameError) {
    expect(caught.code).toBe(code);
    expect(caught.message.length).toBeGreaterThan(0);
    expect(caught.status).toBeGreaterThanOrEqual(400);
  }
}

function expectPrivate(view: unknown, answer: Track) {
  const serialized = JSON.stringify(view);
  for (const value of [answer.id, answer.providerId, answer.title, answer.artist, answer.artworkUrl, answer.sourceUrl]) {
    if (value) expect(serialized).not.toContain(value);
  }
  expect(serialized).not.toContain('"playCount"');
}

describe("Classic and Daily", () => {
  test("Classic requires ten available distinct songs", () => {
    expectGameError(() => solo("classic", tracks(9)), "INSUFFICIENT_TRACKS");
    const pool = tracks(10);
    pool[9].available = false;
    expectGameError(() => solo("classic", pool), "INSUFFICIENT_TRACKS");
    expect(solo().totalRounds).toBe(10);
  });

  test("every stage has the specified excerpt and correct-answer score", () => {
    for (let stage = 0; stage < CLIP_STAGES.length; stage++) {
      let state = solo();
      for (let index = 0; index < stage; index++) state = applySoloCommand(state, { id: commandId(), kind: "skip" }, index);
      const playing = publicSoloGame(state, stage);
      expect(playing.stageIndex).toBe(stage);
      expect(playing.clipDurationSec).toBe(CLIP_STAGES[stage]);
      const answer = currentSoloTrack(state);
      state = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: answer.id }, stage);
      const view = publicSoloGame(state, stage);
      expect(view.status).toBe("reveal");
      expect(view.score).toBe(CLIP_SCORES[stage]);
      expect(view.reveal?.id).toBe(answer.id);
      expect(view.history[0].score).toBe(CLIP_SCORES[stage]);
      expect(view.history[0].solved).toBe(true);
    }
  });

  test("six distinct wrong guesses exhaust a Classic round", () => {
    let state = solo();
    for (let index = 1; index <= 6; index++) state = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: `track-${index}` }, index);
    expect(state.status).toBe("reveal");
    expect(state.score).toBe(0);
    expect(publicSoloGame(state, 6).attempts).toHaveLength(6);
    expect(publicSoloGame(state, 6).history[0].solved).toBe(false);
  });

  test("repeated guessed songs and unknown song IDs do not consume tries", () => {
    const original = solo();
    const state = applySoloCommand(original, { id: commandId(), kind: "guess", trackId: "track-1" }, 1);
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "guess", trackId: "track-1" }, 2), "DUPLICATE_GUESS");
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "guess", trackId: "-1" }, 2), "TRACK_NOT_FOUND");
    expect(state.stageIndex).toBe(1);
    expect(original.stageIndex).toBe(0);
    expect(original.attempts).toHaveLength(0);
  });

  test("command retries cannot award points twice", () => {
    const original = solo();
    const command = { id: commandId(), kind: "guess" as const, trackId: currentSoloTrack(original).id };
    const once = applySoloCommand(original, command, 1);
    const twice = applySoloCommand(once, command, 2);
    expect(twice.score).toBe(100);
    expect(twice.history).toHaveLength(1);
    expect(twice.attempts).toHaveLength(1);
  });

  test("Classic plays exactly ten rounds before completion", () => {
    let state = solo();
    for (let round = 1; round <= 10; round++) {
      expect(state.round).toBe(round);
      state = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: currentSoloTrack(state).id }, round);
      state = applySoloCommand(state, { id: commandId(), kind: "next" }, round);
    }
    expect(state.status).toBe("complete");
    expect(state.score).toBe(1_000);
    expect(state.history).toHaveLength(10);
  });

  test("Daily reveals its one answer and completes only after next", () => {
    const initial = solo("daily", tracks(1));
    const revealed = applySoloCommand(initial, { id: commandId(), kind: "guess", trackId: currentSoloTrack(initial).id }, 1);
    expect(revealed.status).toBe("reveal");
    expect(revealed.totalRounds).toBe(1);
    expect(applySoloCommand(revealed, { id: commandId(), kind: "next" }, 2).status).toBe("complete");
  });

  test("a server-verified out-of-pool Daily guess consumes a stage", () => {
    const original = solo("daily", tracks(1));
    const outside = tracks(2)[1];
    const state = applySoloCommand(original, {
      id: commandId(), kind: "guess", trackId: outside.id,
      guessTrack: { id: outside.id, title: outside.title, artist: outside.artist, available: outside.available },
    }, 1);
    expect(state.status).toBe("playing");
    expect(state.stageIndex).toBe(1);
    expect(state.score).toBe(0);
    expect(publicSoloGame(state, 1).attempts).toEqual([{ label: outside.title + " — " + outside.artist, correct: false }]);
    expectPrivate(publicSoloGame(state, 1), currentSoloTrack(state));
    expectGameError(() => applySoloCommand(state, {
      id: commandId(), kind: "guess", trackId: outside.id,
      guessTrack: { id: outside.id, title: outside.title, artist: outside.artist, available: true },
    }, 2), "DUPLICATE_GUESS");
    expect(original.stageIndex).toBe(0);
  });

  test("out-of-pool Daily guesses require matching available server metadata", () => {
    const state = solo("daily", tracks(1));
    const outside = tracks(2)[1];
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "guess", trackId: outside.id }, 1), "TRACK_NOT_FOUND");
    expectGameError(() => applySoloCommand(state, {
      id: commandId(), kind: "guess", trackId: outside.id,
      guessTrack: { id: "different-id", title: outside.title, artist: outside.artist, available: true },
    }, 1), "TRACK_NOT_FOUND");
    expectGameError(() => applySoloCommand(state, {
      id: commandId(), kind: "guess", trackId: outside.id,
      guessTrack: { id: outside.id, title: outside.title, artist: outside.artist, available: false },
    }, 1), "TRACK_NOT_FOUND");
    expect(state.stageIndex).toBe(0);
  });

  test("playing solo projections recursively omit private answer metadata", () => {
    const state = solo();
    const answer = currentSoloTrack(state);
    expectPrivate(publicSoloGame(state, 0), answer);
    expect(publicSoloGame(state, 0).clipStartSec).toBe(42);
    expect(publicSoloGame(state, 0).serverNow).toBe(0);
  });

  test("difficulty is selection metadata and does not alter the first excerpt", () => {
    const state = createSoloGame({ id: "selection", playerId: host.id, mode: "classic", tracks: tracks(), now: 0, packId: "pack", difficulty: 5, excerptMode: "start" });
    const view = publicSoloGame(state, 0);
    expect(view.difficulty).toBe(5);
    expect(view.stageIndex).toBe(0);
    expect(view.clipDurationSec).toBe(1);
    expect(view.clipStartSec).toBe(0);
  });

  test("invalid modes and commands outside their phase are explicit errors", () => {
    expectGameError(() => solo("party" as SoloMode), "INVALID_MODE");
    const state = solo();
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "next" }, 0), "ROUND_NOT_REVEALED");
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "chart", choice: "higher" }, 0), "INVALID_COMMAND");
  });

  test("caller mutations cannot change a game's frozen answer", () => {
    const pool = tracks();
    const state = solo("classic", pool);
    pool[0].title = "Changed externally";
    expect(currentSoloTrack(state).title).toBe("Secret title 0");
  });
});

describe("Blitz", () => {
  test("every song keeps a sixteen-second excerpt after correct guesses, wrong guesses, and skips", () => {
    for (const excerptMode of ["curated", "start"] as const) {
      let state = createSoloGame({ id: "blitz-clips", playerId: host.id, mode: "blitz", tracks: tracks(3), now: 0, packId: "test-pack", excerptMode });
      const expectClip = (now: number) => {
        const view = publicSoloGame(state, now);
        expect(view.clipDurationSec).toBe(16);
        expect(view.clipStartSec).toBe(excerptMode === "start" ? 0 : 42);
        expect(view.stageIndex).toBe(0);
      };
      expectClip(0);
      state = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: "track-2" }, 1);
      expectClip(1);
      state = applySoloCommand(state, { id: commandId(), kind: "skip" }, 2);
      expectClip(2);
      state = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: currentSoloTrack(state).id }, 3);
      expectClip(3);
    }
  });

  test("correct answers add one point and ten seconds before moving to the next song", () => {
    const state = solo("blitz", tracks(3));
    const next = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: currentSoloTrack(state).id }, 10_000);
    expect(next.score).toBe(1);
    expect(next.deadline).toBe(55_000);
    expect(next.round).toBe(2);
    expect(currentSoloTrack(next).id).toBe("track-1");
    expect(state.deadline).toBe(45_000);
  });

  test("wrong guesses and skips change songs without repeating until the pool is exhausted", () => {
    let state = solo("blitz", tracks(3));
    state = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: "track-2" }, 1);
    expect(currentSoloTrack(state).id).toBe("track-1");
    state = applySoloCommand(state, { id: commandId(), kind: "skip" }, 2);
    expect(currentSoloTrack(state).id).toBe("track-2");
    state = applySoloCommand(state, { id: commandId(), kind: "skip" }, 3);
    expect(currentSoloTrack(state).id).toBe("track-0");
    expect(state.deadline).toBe(45_000);
    expect(state.stageIndex).toBe(0);
  });

  test("the exact deadline expires the game and a late answer cannot extend it", () => {
    const state = solo("blitz");
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "guess", trackId: currentSoloTrack(state).id }, 45_000), "GAME_EXPIRED");
    const expired = advanceSoloGame(state, 45_000);
    expect(expired.status).toBe("complete");
    expect(expired.score).toBe(0);
    expect(expired.deadline).toBeNull();
    expect(publicSoloGame(expired, 45_000).reveal?.id).toBe("track-0");
    expect(state.status).toBe("playing");
  });

  test("a guess one millisecond before expiry may extend the deadline", () => {
    const state = solo("blitz");
    const scored = applySoloCommand(state, { id: commandId(), kind: "guess", trackId: currentSoloTrack(state).id }, 44_999);
    expect(scored.deadline).toBe(55_000);
    expect(advanceSoloGame(scored, 45_000).status).toBe("playing");
  });
});

describe("Chart Clash", () => {
  test("equal-count challengers are excluded and all-equal pools are rejected", () => {
    const pool = tracks(3);
    pool[1].playCount = pool[0].playCount;
    const state = solo("chart", pool);
    expect(publicSoloGame(state, 0).comparison?.challenger.id).toBe(pool[2].id);
    pool[2].playCount = pool[0].playCount;
    expectGameError(() => solo("chart", pool), "NO_COMPARABLE_TRACKS");
  });

  test("a correct prediction earns one point and promotes the frozen challenger", () => {
    const pool = tracks(3);
    const state = solo("chart", pool);
    pool[1].playCount = 0;
    const next = applySoloCommand(state, { id: commandId(), kind: "chart", choice: "higher" }, 1);
    expect(next.score).toBe(1);
    expect(publicSoloGame(next, 1).comparison?.baseline.id).toBe("track-1");
    expect(publicSoloGame(next, 1).comparison?.baseline.playCount).toBe(1_234_667);
    expect(next.round).toBe(2);
  });

  test("the challenger projection exposes no play count", () => {
    const view = publicSoloGame(solo("chart", tracks(3)), 0);
    expect(view.comparison?.baseline.playCount).toBe(1_234_567);
    expect(view.comparison?.challenger).not.toHaveProperty("playCount");
    expect(view.reveal).toBeNull();
    expect(view.history).toHaveLength(0);
  });

  test("a wrong prediction ends the streak and reveals the challenger", () => {
    const state = applySoloCommand(solo("chart", tracks(3)), { id: commandId(), kind: "chart", choice: "lower" }, 1);
    expect(state.status).toBe("complete");
    expect(state.score).toBe(0);
    expect(publicSoloGame(state, 1).reveal?.playCount).toBe(1_234_667);
    expectGameError(() => applySoloCommand(state, { id: commandId(), kind: "chart", choice: "higher" }, 2), "GAME_NOT_PLAYING");
  });
});

describe("Party rooms", () => {
  test("only the host may start or change settings", () => {
    const state = join(room());
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: guest.id, kind: "start" }, 0), "FORBIDDEN");
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: guest.id, kind: "settings", settings }, 0), "FORBIDDEN");
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: "intruder", kind: "guess", trackId: "track-0" }, 0), "NOT_IN_ROOM");
  });

  test("starting requires two players and everyone's ready state", () => {
    expectGameError(() => applyRoomCommand(room(), { id: commandId(), playerId: host.id, kind: "start" }, 0), "NOT_ENOUGH_PLAYERS");
    let state = join(room());
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "start" }, 0), "NOT_READY");
    state = ready(state, host.id);
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "start" }, 0), "NOT_READY");
    state = ready(state, guest.id);
    const playing = applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "start" }, 0);
    expect(playing.status).toBe("playing");
    expect(playing.round).toBe(1);
    expect(playing.deadline).toBe(30_000);
  });

  test("Party accepts 24 members and rejects a twenty-fifth", () => {
    let state = room();
    for (let index = 1; index < 24; index++) state = join(state, { id: `player-${index}`, nickname: `Player ${index}`, avatar: index % 8 });
    expect(publicRoom(state, host.id, 0).players).toHaveLength(24);
    expectGameError(() => join(state, { id: "overflow", nickname: "Overflow", avatar: 0 }), "ROOM_FULL");
  });

  test("players progress through excerpts independently", () => {
    const original = startedRoom();
    const skipped = applyRoomCommand(original, { id: commandId(), playerId: host.id, kind: "skip" }, 1);
    expect(publicRoom(skipped, host.id, 1).stageIndex).toBe(1);
    expect(publicRoom(skipped, host.id, 1).clipDurationSec).toBe(2);
    expect(publicRoom(skipped, guest.id, 1).stageIndex).toBe(0);
    expect(publicRoom(skipped, guest.id, 1).attempts).toHaveLength(0);
    expect(publicRoom(original, host.id, 0).stageIndex).toBe(0);
  });

  test("correct answers use server time for speed points and score only once", () => {
    const original = startedRoom();
    const command = { id: commandId(), playerId: guest.id, kind: "guess" as const, trackId: currentRoomTrack(original)?.id };
    const once = applyRoomCommand(original, command, 15_000);
    const twice = applyRoomCommand(once, command, 15_001);
    expect(publicRoom(twice, guest.id, 15_001).players.find(player => player.id === guest.id)?.score).toBe(550);
    expectGameError(() => applyRoomCommand(twice, { ...command, id: commandId() }, 15_002), "ALREADY_FINISHED");
    expect(once.status).toBe("playing");
  });

  test("six failed attempts end only that player's turn", () => {
    let state = startedRoom();
    for (let index = 0; index < 6; index++) state = applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "skip" }, index);
    expect(state.status).toBe("playing");
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "skip" }, 6), "ALREADY_FINISHED");
    state = applyRoomCommand(state, { id: commandId(), playerId: guest.id, kind: "guess", trackId: currentRoomTrack(state)?.id }, 7);
    expect(state.status).toBe("reveal");
    expect(state.deadline).toBe(3_007);
  });

  test("invalid and repeated guesses do not consume a player's stage", () => {
    const state = applyRoomCommand(startedRoom(), { id: commandId(), playerId: host.id, kind: "guess", trackId: "track-1" }, 1);
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "guess", trackId: "track-1" }, 2), "DUPLICATE_GUESS");
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "guess", trackId: "missing" }, 2), "TRACK_NOT_FOUND");
    expect(publicRoom(state, host.id, 2).stageIndex).toBe(1);
  });

  test("a server-verified out-of-pool room guess consumes only that player's stage", () => {
    const original = startedRoom();
    const outside = tracks(31)[30];
    const state = applyRoomCommand(original, {
      id: commandId(), playerId: host.id, kind: "guess", trackId: outside.id,
      guessTrack: { id: outside.id, title: outside.title, artist: outside.artist, available: true },
    }, 1);
    expect(publicRoom(state, host.id, 1).stageIndex).toBe(1);
    expect(publicRoom(state, guest.id, 1).stageIndex).toBe(0);
    expect(publicRoom(state, host.id, 1).attempts).toEqual([{ label: outside.title + " — " + outside.artist, correct: false }]);
    expectGameError(() => applyRoomCommand(state, {
      id: commandId(), playerId: host.id, kind: "guess", trackId: outside.id,
      guessTrack: { id: outside.id, title: outside.title, artist: outside.artist, available: true },
    }, 2), "DUPLICATE_GUESS");
    expect(original.players.find(player => player.id === host.id)?.stageIndex).toBe(0);
  });

  test("out-of-pool room guesses reject missing, mismatched, or unavailable metadata", () => {
    const state = startedRoom();
    const outside = tracks(31)[30];
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "guess", trackId: outside.id }, 1), "TRACK_NOT_FOUND");
    expectGameError(() => applyRoomCommand(state, {
      id: commandId(), playerId: host.id, kind: "guess", trackId: outside.id,
      guessTrack: { id: "different-id", title: outside.title, artist: outside.artist, available: true },
    }, 1), "TRACK_NOT_FOUND");
    expectGameError(() => applyRoomCommand(state, {
      id: commandId(), playerId: host.id, kind: "guess", trackId: outside.id,
      guessTrack: { id: outside.id, title: outside.title, artist: outside.artist, available: false },
    }, 1), "TRACK_NOT_FOUND");
    expect(publicRoom(state, host.id, 1).stageIndex).toBe(0);
  });

  test("playing room projections omit answer metadata and other players' attempts", () => {
    let state = startedRoom();
    const answer = currentRoomTrack(state);
    expect(answer).not.toBeNull();
    if (answer) expectPrivate(publicRoom(state, host.id, 0), answer);
    state = applyRoomCommand(state, { id: commandId(), playerId: guest.id, kind: "guess", trackId: "track-1" }, 1);
    expect(publicRoom(state, host.id, 1).attempts).toHaveLength(0);
    expect(publicRoom(state, guest.id, 1).attempts).toHaveLength(1);
  });

  test("round timeout rejects answers at the exact boundary", () => {
    const state = startedRoom();
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "guess", trackId: currentRoomTrack(state)?.id }, 30_000), "GAME_NOT_PLAYING");
    expect(publicRoom(state, host.id, 30_000).status).toBe("reveal");
    expect(roomNextDeadline(state)).toBe(30_000);
  });

  test("reveals last three seconds and time advancement catches up missed rounds", () => {
    const original = startedRoom();
    const revealed = advanceRoom(original, 30_000);
    expect(revealed.status).toBe("reveal");
    expect(revealed.deadline).toBe(33_000);
    expect(advanceRoom(revealed, 32_999).status).toBe("reveal");
    expect(advanceRoom(revealed, 33_000).round).toBe(2);
    const completed = advanceRoom(original, 99_000);
    expect(completed.status).toBe("complete");
    expect(completed.history).toHaveLength(3);
    expect(completed.winnerIds).toEqual([host.id, guest.id]);
    expect(original.status).toBe("playing");
    expect(original.history).toHaveLength(0);
  });

  test("host transfer waits for the full thirty-second disconnect grace", () => {
    const original = join(room());
    const state = applyRoomCommand(original, { id: commandId(), playerId: host.id, kind: "disconnect" }, 1_000);
    expect(roomNextDeadline(state)).toBe(31_000);
    expect(advanceRoom(state, 30_999).hostId).toBe(host.id);
    expect(advanceRoom(state, 31_000).hostId).toBe(guest.id);
    expect(state.hostId).toBe(host.id);
  });

  test("heartbeat or join reconnects without extending a disconnect's grace", () => {
    const original = join(room());
    const disconnected = applyRoomCommand(original, { id: commandId(), playerId: host.id, kind: "disconnect" }, 0);
    const repeated = applyRoomCommand(disconnected, { id: commandId(), playerId: host.id, kind: "disconnect" }, 10_000);
    expect(roomNextDeadline(repeated)).toBe(30_000);
    const connected = applyRoomCommand(repeated, { id: commandId(), playerId: host.id, kind: "heartbeat" }, 20_000);
    expect(advanceRoom(connected, 30_000).hostId).toBe(host.id);
    expect(connected.players.find(player => player.id === host.id)?.disconnectedAt).toBeNull();
    const rejoined = join(disconnected, host, 25_000);
    expect(rejoined.players.find(player => player.id === host.id)?.online).toBe(true);
  });

  test("all disconnected players expire gracefully instead of keeping a room alive", () => {
    let state = join(room());
    state = applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "disconnect" }, 0);
    state = applyRoomCommand(state, { id: commandId(), playerId: guest.id, kind: "disconnect" }, 0);
    expect(advanceRoom(state, 30_000).status).toBe("complete");
    expect(advanceRoom(state, 30_000).winnerIds).toEqual([]);
  });

  test("leaving the lobby immediately transfers host and removes membership", () => {
    const original = join(room());
    const state = applyRoomCommand(original, { id: commandId(), playerId: host.id, kind: "leave" }, 1);
    expect(state.hostId).toBe(guest.id);
    expect(publicRoom(state, guest.id, 1).players).toHaveLength(1);
    expectGameError(() => applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "ready", ready: true }, 2), "NOT_IN_ROOM");
  });

  test("pack replacement is lobby-only, validates the pool, and keeps input immutable", () => {
    const original = room();
    const pool = tracks(5).map(track => ({ ...track, id: `replacement-${track.id}` }));
    const replaced = replaceRoomTracks(original, pool);
    expect(replaced.tracks[0].id).toBe("replacement-track-0");
    expect(original.tracks[0].id).toBe("track-0");
    expectGameError(() => replaceRoomTracks(original, tracks(2)), "INSUFFICIENT_TRACKS");
    expectGameError(() => replaceRoomTracks(startedRoom(), pool), "LOBBY_ONLY");
    expect(currentRoomTrack(original)).toBeNull();
  });

  test("changing settings clears ready states before the next start", () => {
    const state = ready(ready(join(room()), host.id), guest.id);
    const changed = applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "settings", settings: { ...settings, rounds: 10, excerptMode: "start" } }, 1);
    expect(changed.totalRounds).toBe(10);
    expect(changed.players.every(player => !player.ready)).toBe(true);
    expectGameError(() => applyRoomCommand(changed, { id: commandId(), playerId: host.id, kind: "start" }, 2), "NOT_READY");
  });
});

describe("Duels", () => {
  test("Duel limits membership to two and always plays seven rounds", () => {
    const state = join(room("duel"));
    expect(state.totalRounds).toBe(7);
    expect(state.settings.rounds).toBe(7);
    expectGameError(() => join(state, { id: "third", nickname: "Third", avatar: 2 }), "ROOM_FULL");
  });

  test("the first atomically processed correct guess wins the round", () => {
    const original = startedRoom("duel");
    const answer = currentRoomTrack(original);
    const command = { id: commandId(), playerId: host.id, kind: "guess" as const, trackId: answer?.id };
    const first = applyRoomCommand(original, command, 1_000);
    expect(first.status).toBe("reveal");
    expect(first.players.find(player => player.id === host.id)?.score).toBe(1);
    expect(first.players.find(player => player.id === guest.id)?.score).toBe(0);
    expectGameError(() => applyRoomCommand(first, { id: commandId(), playerId: guest.id, kind: "guess", trackId: answer?.id }, 1_000), "GAME_NOT_PLAYING");
    expect(applyRoomCommand(first, command, 1_001).players.find(player => player.id === host.id)?.score).toBe(1);
  });

  test("two exhausted turns reveal with no point awarded", () => {
    let state = startedRoom("duel");
    for (let index = 0; index < 6; index++) {
      state = applyRoomCommand(state, { id: commandId(), playerId: host.id, kind: "skip" }, index * 2);
      state = applyRoomCommand(state, { id: commandId(), playerId: guest.id, kind: "skip" }, index * 2 + 1);
    }
    expect(state.status).toBe("reveal");
    expect(state.players.every(player => player.score === 0)).toBe(true);
  });

  test("a timed-out round allows a drawn match after seven rounds", () => {
    let state = advanceRoom(startedRoom("duel"), 33_000);
    let now = 33_000;
    for (let round = 2; round <= 7; round++) {
      const playerId = round % 2 === 0 ? host.id : guest.id;
      state = applyRoomCommand(state, { id: commandId(), playerId, kind: "guess", trackId: currentRoomTrack(state)?.id }, now + 1);
      now += 3_001;
      state = advanceRoom(state, now);
    }
    expect(state.status).toBe("complete");
    expect(state.players.map(player => player.score)).toEqual([3, 3]);
    expect(state.winnerIds).toEqual([host.id, guest.id]);
    expect(state.history).toHaveLength(7);
  });

  test("a thirty-second disconnect forfeits to the opponent who remains", () => {
    const original = startedRoom("duel");
    const disconnected = applyRoomCommand(original, { id: commandId(), playerId: host.id, kind: "disconnect" }, 0);
    expect(advanceRoom(disconnected, 29_999).status).toBe("playing");
    const forfeited = advanceRoom(disconnected, 30_000);
    expect(forfeited.status).toBe("complete");
    expect(forfeited.winnerIds).toEqual([guest.id]);
    expect(forfeited.hostId).toBe(guest.id);
    expect(applyRoomCommand(forfeited, { id: commandId(), playerId: host.id, kind: "heartbeat" }, 30_001).status).toBe("complete");
  });

  test("reconnecting during the grace prevents a forfeit", () => {
    const disconnected = applyRoomCommand(startedRoom("duel"), { id: commandId(), playerId: host.id, kind: "disconnect" }, 0);
    const restored = applyRoomCommand(disconnected, { id: commandId(), playerId: host.id, kind: "heartbeat" }, 29_999);
    expect(advanceRoom(restored, 30_000).status).toBe("reveal");
    expect(advanceRoom(restored, 30_000).winnerIds).toEqual([]);
  });

  test("leaving immediately forfeits a Duel", () => {
    const state = applyRoomCommand(startedRoom("duel"), { id: commandId(), playerId: host.id, kind: "leave" }, 1);
    expect(state.status).toBe("complete");
    expect(state.winnerIds).toEqual([guest.id]);
    expect(publicRoom(state, guest.id, 1).completionReason).toBe("forfeit");
  });

  test("rematch keeps the room code and settings while returning to an unready lobby", () => {
    const disconnected = applyRoomCommand(startedRoom("duel"), { id: commandId(), playerId: host.id, kind: "disconnect" }, 0);
    const complete = advanceRoom(disconnected, 30_000);
    const command = { id: commandId(), playerId: guest.id, kind: "rematch" as const };
    const state = applyRoomCommand(complete, command, 30_001);
    expect(state.status).toBe("lobby");
    expect(state.code).toBe("ABC123");
    expect(state.settings).toEqual(complete.settings);
    expect(state.players).toHaveLength(2);
    expect(state.players.every(player => player.score === 0 && !player.ready)).toBe(true);
    expect(state.history).toHaveLength(0);
    expect(state.winnerIds).toHaveLength(0);
    expect(applyRoomCommand(state, command, 30_002).status).toBe("lobby");
    expect(complete.status).toBe("complete");
  });
});
