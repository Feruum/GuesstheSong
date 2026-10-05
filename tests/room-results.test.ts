import { describe, expect, test } from "bun:test";
import { rankRoomPlayers } from "../src/lib/utils";

describe("multiplayer result places", () => {
  test("puts the authoritative forfeit winner first even with a lower score", () => {
    const host = { id: "host", score: 10, nickname: "Host" };
    const opponent = { id: "opponent", score: 0, nickname: "Opponent" };
    expect(rankRoomPlayers([host, opponent], ["opponent"])).toEqual([
      { player: opponent, rank: 1 },
      { player: host, rank: 2 },
    ]);
  });

  test("gives both listeners first place in a zero-point Duel draw", () => {
    const players = [{ id: "host", score: 0 }, { id: "opponent", score: 0 }];
    expect(rankRoomPlayers(players, ["host", "opponent"]).map(entry => entry.rank)).toEqual([1, 1]);
  });

  test("shares Party places for equal scores and leaves the next place after the tie", () => {
    const players = [{ id: "third", score: 40 }, { id: "winner-b", score: 100 }, { id: "fourth", score: 20 }, { id: "winner-a", score: 100 }];
    expect(rankRoomPlayers(players, ["winner-a", "winner-b"]).map(({ player, rank }) => [player.id, rank])).toEqual([
      ["winner-b", 1], ["winner-a", 1], ["third", 3], ["fourth", 4],
    ]);
  });

  test("preserves the input players and ranks ties below the winners consistently", () => {
    const players = Object.freeze([
      Object.freeze({ id: "third", score: 5 }),
      Object.freeze({ id: "first", score: 20 }),
      Object.freeze({ id: "second", score: 5 }),
    ]);
    const ranked = rankRoomPlayers(players, ["first"]);
    expect(ranked.map(({ player, rank }) => [player.id, rank])).toEqual([["first", 1], ["third", 2], ["second", 2]]);
    expect(players.map(player => player.id)).toEqual(["third", "first", "second"]);
    expect(ranked[0]?.player).toBe(players[1]);
  });
});
