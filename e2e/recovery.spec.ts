import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getStore } from "../src/server/atomic-store";
import { catalogTrack } from "../src/server/catalog";
import type { SoloSession } from "../src/server/game-service";

const headers = { Origin: "http://127.0.0.1:3000" };
async function game(page: import("@playwright/test").Page) {
  await page.request.get("/api/v1/guest");
  return (await (await page.request.post("/api/v1/games", { headers, data: { mode: "classic", packId: "global-mix", difficulty: 0, excerptMode: "curated" } })).json()).game;
}
test("unlocking during playback resets audio and Volume supports the keyboard", async ({ page }) => {
  const current = await game(page); const known = (await catalogTrack("audius-G0wyE"))!;
  await getStore().update<SoloSession>(`solo:${current.id}`, value => ({ ...value, game: { ...value.game, tracks: [known, ...value.game.tracks.filter(track => track.id !== known.id)] } }));
  await page.goto(`/play/classic/${current.id}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("skip-song").click(); await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 2-second clip");
  await page.getByTestId("play-clip").click(); await expect(page.getByRole("button", { name: "Pause clip" })).toBeVisible();
  await page.getByTestId("skip-song").click(); await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 4-second clip");
  await expect(page.getByTestId("audio-player")).toHaveAttribute("data-state", "ready");
  const volume = page.getByRole("slider", { name: "Volume", exact: true }); await volume.focus(); await volume.press("ArrowLeft"); await expect(volume).toHaveAttribute("aria-valuenow", "69");
  const result = await new AxeBuilder({ page }).include("#music-app").analyze(); expect(result.violations.filter(item => ["critical", "serious"].includes(item.impact || ""))).toEqual([]);
});

test("Blitz plays a real sixteen-second clip before and after a skip", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { musicTestAudio: HTMLMediaElement }).musicTestAudio = this;
      return original.call(this);
    };
  });
  await page.request.get("/api/v1/guest");
  const current = (await (await page.request.post("/api/v1/games", {
    headers,
    data: { mode: "blitz", packId: "global-mix", difficulty: 0, excerptMode: "curated" },
  })).json()).game;
  const known = (await catalogTrack("audius-G0wyE"))!;
  await getStore().update<SoloSession>(`solo:${current.id}`, value => ({ ...value, game: { ...value.game, tracks: [known, ...value.game.tracks.filter(track => track.id !== known.id)] } }));
  await page.goto(`/play/blitz/${current.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 16-second clip");
  await page.getByTestId("play-clip").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { musicTestAudio?: HTMLMediaElement }).musicTestAudio?.duration || 0)).toBeGreaterThan(15.8);
  const duration = await page.evaluate(() => (window as unknown as { musicTestAudio: HTMLMediaElement }).musicTestAudio.duration);
  expect(duration).toBeLessThan(16.1);
  await page.getByRole("button", { name: "Pause clip", exact: true }).click();
  await page.getByTestId("skip-song").click();
  await expect(page.getByTestId("solo-game")).toContainText("Song 2");
  await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 16-second clip");
});
test("cached rooms show expiration and strangers must join an invite", async ({ browser, page }) => {
  await page.request.get("/api/v1/guest");
  const room = (await (await page.request.post("/api/v1/rooms", { headers, data: { mode: "party" } })).json()).room;
  const secondContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" }); const second = await secondContext.newPage();
  await second.goto(`/rooms/${room.code}`, { waitUntil: "domcontentloaded" }); await expect(second.getByRole("heading", { name: "You're invited." })).toBeVisible();
  await second.getByRole("button", { name: "Join this room" }).click(); await expect(second.getByTestId("room-view")).toHaveAttribute("data-state", "lobby");
  await page.goto(`/rooms/${room.code}`, { waitUntil: "domcontentloaded" }); await expect(page.getByTestId("room-connection")).toHaveText("Connected");
  await getStore().remove(`room:${room.code}`);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("room-entrance")).toHaveAttribute("data-state", "expired");
  await secondContext.close();
});
test("cancellation ignores an in-flight matched response", async ({ page }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); let reached!: () => void; const entered = new Promise<void>(resolve => { reached = resolve; });
  await page.route("**/api/v1/matchmaking", async route => {
    if (route.request().method() === "POST") { reached(); await held; await route.fulfill({ json: { status: "matched", code: "ABCDEF" } }); }
    else await route.fulfill({ json: { status: "cancelled" } });
  });
  await page.goto("/duel", { waitUntil: "domcontentloaded" }); await page.getByRole("button", { name: "Find an opponent" }).click(); await entered;
  await page.getByRole("button", { name: "Cancel search" }).click(); release();
  await expect(page.getByRole("button", { name: "Find an opponent" })).toBeVisible(); await expect(page).toHaveURL(/\/duel$/);
});
test("Daily refreshes at server UTC midnight and accepts a new lower revision", async ({ page }) => {
  await page.request.get("/api/v1/guest"); const daily = (await (await page.request.get("/api/v1/daily")).json()).game;
  const midnight = Date.UTC(2030, 9, 7); const serverNow = midnight - 1000;
  await page.clock.install({ time: new Date(serverNow) }); let requests = 0;
  await page.route("**/api/v1/daily", route => {
    requests++; const next = requests > 1;
    return route.fulfill({ json: { game: { ...daily, id: next ? crypto.randomUUID() : daily.id, status: next ? "playing" : "complete", revision: next ? 1 : 20, dailyDate: next ? "2030-10-07" : "2030-10-06", serverNow: next ? midnight + 200 : serverNow, score: 0, history: [], attempts: [], reveal: null, stageIndex: 0 } } });
  });
  await page.goto("/daily", { waitUntil: "domcontentloaded" }); await expect(page.getByTestId("game-results")).toBeVisible();
  await page.clock.runFor(1600); await expect(page.getByTestId("solo-game")).toHaveAttribute("data-state", "playing"); await expect(page.getByTestId("solo-game")).toContainText("2030-10-07");
});
