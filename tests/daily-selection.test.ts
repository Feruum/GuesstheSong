import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { randomInt, randomUUID } from "node:crypto";
import { getStore } from "../src/server/atomic-store";
import { searchCatalog } from "../src/server/catalog";
import { getPool } from "../src/server/db";
import { commandSolo, startSolo, type SoloSession } from "../src/server/game-service";
import { createGuest } from "../src/server/sessions";
import { utcDate } from "../src/server/security";
import type { GuestView } from "../src/shared/contracts";

const guests: GuestView[] = [];
const dates: string[] = [];
const gameIds: string[] = [];
async function listener() {
  const guest = (await createGuest()).guest;
  guests.push(guest);
  return guest;
}
async function unusedDate() {
  for (;;) {
    const date = utcDate(Date.UTC(2400, 0, 1) + randomInt(100_000) * 86_400_000);
    if (!(await getPool().query("SELECT 1 FROM daily_challenges WHERE date=$1", [date])).rowCount && !dates.includes(date)) {
      dates.push(date);
      return date;
    }
  }
}
async function onDay<T>(date: string, action: () => Promise<T>) {
  const clock = spyOn(Date, "now").mockReturnValue(Date.parse(`${date}T12:00:00Z`));
  try { return await action(); } finally { clock.mockRestore(); }
}
async function state(id: string) {
  gameIds.push(id);
  return (await getStore().load<SoloSession>(`solo:${id}`))!.value.game;
}
afterAll(async () => {
  for (const guest of guests) {
    const entries = await getPool().query("SELECT game_id FROM daily_entries WHERE guest_id=$1", [guest.id]);
    gameIds.push(...entries.rows.map(entry => entry.game_id));
  }
  for (const id of new Set(gameIds)) await getStore().remove(`solo:${id}`);
  for (const guest of guests) {
    await getPool().query("DELETE FROM game_results WHERE guest_id=$1", [guest.id]);
    await getPool().query("DELETE FROM daily_entries WHERE guest_id=$1", [guest.id]);
    await getPool().query("DELETE FROM guests WHERE id=$1", [guest.id]);
  }
  for (const date of dates) await getPool().query("DELETE FROM daily_challenges WHERE date=$1", [date]);
}, 30_000);

describe("Daily hitmaker selection", () => {
  test("new UTC challenges use only hitmakers and ignore caller pack, difficulty and excerpt settings", async () => {
    const first = await listener(), second = await listener();
    const date = await unusedDate();
    const hitIds = new Set((await searchCatalog({ packId: "featured-hits", limit: 2000 })).map(track => track.id));
    expect(hitIds.size).toBeGreaterThan(0);
    await onDay(date, async () => {
      const [{ game }, { game: other }] = await Promise.all([
        startSolo(first, { mode: "daily", packId: "not-a-real-pack", difficulty: 5, excerptMode: "start" }),
        startSolo(second, { mode: "daily", packId: "global-mix", difficulty: 1, excerptMode: "start" }),
      ]);
      await state(other.id);
      const saved = await state(game.id);
      expect(game.packId).toBe("featured-hits");
      expect(hitIds.has(saved.tracks[0].id)).toBe(true);
      expect(game.difficulty).toBe(0);
      expect(game.totalRounds).toBe(1);
      expect(game.reveal).toBeNull();
      expect(saved.excerptMode).toBe("curated");
      expect((await state(other.id)).tracks[0].id).toBe(saved.tracks[0].id);
      expect(other.packId).toBe("featured-hits");
      expect(other.dailyDate).toBe(date);
      const answer = { id: randomUUID(), kind: "guess" as const, trackId: saved.tracks[0].id };
      expect((await commandSolo(game.id, first.id, answer)).game.score).toBe(100);
      expect((await commandSolo(game.id, first.id, answer)).game.score).toBe(100);
      await commandSolo(game.id, first.id, { id: randomUUID(), kind: "next" });
      const result = await getPool().query("SELECT pack_id,score FROM game_results WHERE game_id=$1 AND guest_id=$2", [game.id, first.id]);
      expect(result.rows).toEqual([{ pack_id: "featured-hits", score: 100 }]);
    });
  }, 30_000);

  test("an existing shared song and saved attempts survive the switch; the next UTC day uses hitmakers", async () => {
    const guest = await listener();
    const date = await unusedDate();
    let nextDate = utcDate(Date.parse(`${date}T00:00:00Z`) + 86_400_000);
    while ((await getPool().query("SELECT 1 FROM daily_challenges WHERE date=$1", [nextDate])).rowCount || dates.includes(nextDate)) {
      nextDate = utcDate(Date.parse(`${nextDate}T00:00:00Z`) + 86_400_000);
    }
    dates.push(nextDate);
    const hitIds = new Set((await searchCatalog({ packId: "featured-hits", limit: 2000 })).map(track => track.id));
    const legacy = (await searchCatalog({ packId: "global-mix", limit: 2000, audiusOnly: true }))[0];
    expect(legacy).toBeTruthy();
    expect(hitIds.has(legacy.id)).toBe(false);
    await getPool().query("INSERT INTO daily_challenges(date,track_id) VALUES($1,$2)", [date, legacy.id]);
    let oldId = "";
    await onDay(date, async () => {
      const { game } = await startSolo(guest, { mode: "daily", packId: "featured-hits", difficulty: 0, excerptMode: "curated" });
      oldId = game.id;
      expect((await state(game.id)).tracks[0].id).toBe(legacy.id);
      expect(game.packId).toBe("global-mix");
      await commandSolo(game.id, guest.id, { id: randomUUID(), kind: "skip" });
      await getStore().remove(`solo:${game.id}`);
      const resumed = (await startSolo(guest, { mode: "daily", packId: "not-a-real-pack", difficulty: 5, excerptMode: "start" })).game;
      expect(resumed.id).toBe(game.id);
      expect(resumed.stageIndex).toBe(1);
      expect(resumed.packId).toBe("global-mix");
      expect((await state(resumed.id)).tracks[0].id).toBe(legacy.id);
    });
    await onDay(nextDate, async () => {
      const { game } = await startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" });
      expect(game.id).not.toBe(oldId);
      expect(game.dailyDate).toBe(nextDate);
      expect(game.stageIndex).toBe(0);
      expect(game.packId).toBe("featured-hits");
      expect(hitIds.has((await state(game.id)).tracks[0].id)).toBe(true);
      const previous = (await getPool().query("SELECT state FROM daily_entries WHERE date=$1 AND guest_id=$2", [date, guest.id])).rows[0].state as SoloSession;
      expect(previous.game.stageIndex).toBe(1);
      expect(previous.game.tracks[0].id).toBe(legacy.id);
    });
  }, 30_000);

  test("an unavailable hitmaker collection never falls back to the independent catalog", async () => {
    const guest = await listener();
    const date = await unusedDate();
    const before = { private: process.env.DEEZER_PRIVATE_PREVIEWS, public: process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED };
    try {
      process.env.DEEZER_PRIVATE_PREVIEWS = "false";
      process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED = "false";
      expect((await searchCatalog({ packId: "global-mix", audiusOnly: true, limit: 1 })).length).toBe(1);
      await onDay(date, async () => {
        await expect(startSolo(guest, { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" })).rejects.toMatchObject({ code: "EMPTY_CATALOG" });
        expect((await getPool().query("SELECT 1 FROM daily_challenges WHERE date=$1", [date])).rowCount).toBe(0);
        expect((await getPool().query("SELECT 1 FROM daily_entries WHERE date=$1 AND guest_id=$2", [date, guest.id])).rowCount).toBe(0);
      });
    } finally {
      if (before.private === undefined) delete process.env.DEEZER_PRIVATE_PREVIEWS; else process.env.DEEZER_PRIVATE_PREVIEWS = before.private;
      if (before.public === undefined) delete process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED; else process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED = before.public;
    }
  }, 30_000);
});
