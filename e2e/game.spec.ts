import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { getStore } from "../src/server/atomic-store";
import type { SoloSession, RoomSession } from "../src/server/game-service";
import { getPool } from "../src/server/db";
import { catalogTrack } from "../src/server/catalog";

const origin = "http://127.0.0.1:3000";
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on("pageerror", error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page) || []).toEqual([]); });
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(`/api/v1${path}`, { headers: { Origin: origin }, data });
  expect(response.ok(), await response.text()).toBe(true); return response.json();
}
async function guest(page: Page) { return (await (await page.request.get("/api/v1/guest")).json()).guest; }
async function start(page: Page, mode: string) {
  await guest(page);
  return (await post(page, "/games", { mode, packId: "global-mix", difficulty: 0, excerptMode: "curated" })).game;
}
async function command(page: Page, id: string, kind: string, extra: Record<string, unknown> = {}) { return (await post(page, `/games/${id}/commands`, { id: crypto.randomUUID(), kind, ...extra })).game; }
async function privateSolo(id: string) { return (await getStore().load<SoloSession>(`solo:${id}`))!.value.game; }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
test("discovery, verified filters, pack details and keyboard setup", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Know it in a beat." })).toBeVisible();
  const pack = page.locator('a[href="/packs/global-mix"]');
  const catalog = (await (await page.request.get("/api/v1/packs")).json()).packs as { id: string; count: number }[];
  const total = catalog.find(item => item.id === "global-mix")!.count;
  expect(total).toBeGreaterThanOrEqual(1000);
  await expect(pack).toContainText(total.toLocaleString("en-US"));
  await noOverflow(page);
  const accessibility = await new AxeBuilder({ page }).include("#music-app").analyze();
  expect(accessibility.violations.filter(item => ["critical", "serious"].includes(item.impact || ""))).toEqual([]);
  await page.screenshot({ path: `design/runtime-discover-${info.project.name}.png`, fullPage: true });
  await pack.click();
  await expect(page.getByRole("heading", { name: "The global mix", exact: true })).toBeVisible();
  await page.goto("/play/classic", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Find your rhythm." })).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Let's play" }).click();
  await expect(page.locator('[data-testid="solo-game"][data-state="playing"]')).toBeVisible();
});
test("Classic clips unlock, replay real audio, complete ten rounds and save results", async ({ page }, info) => {
  const game = await start(page, "classic");
  const known = await catalogTrack("audius-G0wyE");
  await getStore().update<SoloSession>(`solo:${game.id}`, value => ({ ...value, game: { ...value.game, tracks: [known!, ...value.game.tracks.filter(track => track.id !== known!.id)] } }));
  await page.goto(`/play/classic/${game.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "What’s this song?" })).toBeVisible();
  await expect(page.locator('[data-testid="solo-game"]')).not.toContainText(known!.title);
  await page.getByTestId("play-clip").click();
  await expect(page.getByRole("button", { name: "Pause clip", exact: true })).toBeVisible();
  await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 1-second clip", { timeout: 20000 });
  await page.getByTestId("skip-song").click();
  await expect(page.getByTestId("skip-song")).toContainText("4s");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("skip-song")).toContainText("4s");
  await page.screenshot({ path: `design/runtime-classic-${info.project.name}.png`, fullPage: true });
  await page.getByLabel("Search a song or artist").fill(known!.title);
  const suggestion = page.getByRole("option").filter({ hasText: known!.title }).first();
  await expect(suggestion).toBeVisible();
  await page.getByLabel("Search a song or artist").press("ArrowDown");
  await page.getByLabel("Search a song or artist").press("Enter");
  await expect(page.getByTestId("selected-song")).toBeVisible();
  await page.getByTestId("submit-guess").click();
  await expect(page.getByRole("button", { name: "Next song" })).toBeVisible();
  for (let round = 0; round < 10; round++) {
    const state = await privateSolo(game.id);
    if (state.status === "playing") await command(page, game.id, "guess", { trackId: state.tracks[state.trackIndex].id });
    await command(page, game.id, "next");
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("game-results")).toBeVisible();
  expect((await getPool().query("SELECT score FROM game_results WHERE game_id=$1", [game.id])).rows[0].score).toBe(980);
  await noOverflow(page);
});
test("Daily resumes attempts and offers shareable results", async ({ page }) => {
  await guest(page); const game = (await (await page.request.get("/api/v1/daily")).json()).game;
  await page.goto("/daily", { waitUntil: "domcontentloaded" }); await page.getByTestId("skip-song").click();
  await expect(page.getByTestId("skip-song")).toContainText("4s");
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByTestId("skip-song")).toContainText("4s");
  const state = await privateSolo(game.id);
  await command(page, game.id, "guess", { trackId: state.tracks[0].id }); await command(page, game.id, "next");
  await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByTestId("game-results")).toBeVisible();
  await expect(page.getByRole("button", { name: /Share/ })).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(page.getByText("Result copied.", { exact: true })).toBeVisible();
  const shared = await page.evaluate(() => navigator.clipboard.readText());
  expect(shared.split("\n")).toHaveLength(4); expect(shared).not.toContain("\\n");
});
test("Blitz adds server time for a correct answer and expires", async ({ page }) => {
  const game = await start(page, "blitz"); const state = await privateSolo(game.id);
  const next = await command(page, game.id, "guess", { trackId: state.tracks[0].id });
  expect(next.score).toBe(1); expect(next.deadline).toBe(game.deadline + 10000);
  await page.goto(`/play/blitz/${game.id}`, { waitUntil: "domcontentloaded" });
  await getStore().update<SoloSession>(`solo:${game.id}`, value => ({ ...value, game: { ...value.game, deadline: Date.now() + 300 } }));
  await expect(page.getByTestId("game-results")).toBeVisible();
  await noOverflow(page);
});
test("Chart Clash hides challenger counts and completes on a wrong prediction", async ({ page }) => {
  const game = await start(page, "chart"); const state = await privateSolo(game.id);
  await page.goto(`/play/chart/${game.id}`, { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "More plays. Or fewer?" })).toBeVisible();
  const correct = state.tracks[state.trackIndex].playCount > state.tracks[state.baselineIndex!].playCount ? "Higher" : "Lower";
  await page.getByRole("button", { name: correct === "Higher" ? "Lower" : "Higher", exact: true }).click();
  await expect(page.getByTestId("game-results")).toBeVisible(); await noOverflow(page);
});
test("audio failure keeps guesses and recovers on retry", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      this.addEventListener("playing", () => {
        const audit = window as unknown as { musicRetryPlays?: number };
        audit.musicRetryPlays = (audit.musicRetryPlays || 0) + 1;
      }, { once: true });
      return original.call(this);
    };
  });
  const game = await start(page, "classic");
  const known = (await catalogTrack("audius-G0wyE"))!;
  await getStore().update<SoloSession>(`solo:${game.id}`, value => ({ ...value, game: { ...value.game, tracks: [known, ...value.game.tracks.filter(track => track.id !== known.id)] } }));
  await page.route("**/api/v1/audio/**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "AUDIO_UNAVAILABLE", message: "Test provider interruption" } }) }));
  await page.goto(`/play/classic/${game.id}`, { waitUntil: "domcontentloaded" }); await page.getByTestId("play-clip").click();
  await expect(page.getByText(/couldn't play|Playback didn't start/)).toBeVisible();
  expect((await privateSolo(game.id)).attempts).toHaveLength(0);
  expect(await page.evaluate(() => (window as unknown as { musicRetryPlays?: number }).musicRetryPlays || 0)).toBe(0);
  await page.unroute("**/api/v1/audio/**"); await page.getByRole("button", { name: "Retry audio" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { musicRetryPlays?: number }).musicRetryPlays || 0)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Retry audio" })).toHaveCount(0);
  expect((await privateSolo(game.id)).attempts).toHaveLength(0);
});
test("a nonzero curated excerpt decodes as a bounded one-second clip", async ({ page }) => {
  const game = await start(page, "classic"); const known = (await catalogTrack("audius-G0wyE"))!;
  await getStore().update<SoloSession>(`solo:${game.id}`, value => ({ ...value, game: { ...value.game, tracks: [{ ...known, clipStartSec: 20 }, ...value.game.tracks.filter(track => track.id !== known.id)] } }));
  await page.goto(`/play/classic/${game.id}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("play-clip").click();
  await expect(page.getByRole("button", { name: "Pause clip", exact: true })).toBeVisible();
  await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 1-second clip", { timeout: 20000 });
  await expect(page.getByTestId("audio-player")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("audio-player").getByRole("alert")).toHaveCount(0);
});
test("Party and Duel lobby, live socket rounds and reconnect", async ({ browser, page }, info) => {
  const profile = await guest(page); const secondContext = await browser.newContext({ viewport: info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 900 } });
  const second = await secondContext.newPage(); await guest(second);
  for (const mode of ["party", "duel"]) {
    const room = (await post(page, "/rooms", { mode, settings: { packId: "global-mix", rounds: mode === "party" ? 3 : 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } })).room;
    await post(second, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "join" });
    await page.goto(`/rooms/${room.code}`, { waitUntil: "domcontentloaded" }); await second.goto(`/rooms/${room.code}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Play it together." })).toBeVisible();
    await post(page, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "ready", ready: true }); await post(second, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "ready", ready: true });
    await expect(page.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await post(page, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "start" });
    await expect(page.getByTestId("skip-song")).toBeVisible(); await expect(second.getByTestId("skip-song")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByTestId("skip-song")).toBeVisible();
    await expect(page.getByTestId("room-connection")).toHaveText("Connected");
    await expect.poll(async () => (await getStore().load<RoomSession>(`room:${room.code}`))?.value.game.players.find(player => player.id === profile.id)?.online).toBe(true);
    const stored = (await getStore().load<RoomSession>(`room:${room.code}`))!;
    expect(stored.value.game.players.find(player => player.id === profile.id)?.online).toBe(true);
    await noOverflow(page);
    await page.screenshot({ path: `design/runtime-${mode}-${info.project.name}.png`, fullPage: true });
    await post(second, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "leave" }); await post(page, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "leave" });
  }
  await secondContext.close();
});
test("a guest winning a Duel by host disconnect gets first place", async ({ browser, page }, info) => {
  const host = await guest(page);
  const otherContext = await browser.newContext({ viewport: info.project.name === "mobile" ? { width: 375, height: 812 } : { width: 1440, height: 900 } });
  try {
    const other = await otherContext.newPage();
    const winner = await guest(other);
    const room = (await post(page, "/rooms", { mode: "duel", settings: { packId: "global-mix", rounds: 7, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" } })).room;
    await post(other, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "join" });
    await post(page, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "ready", ready: true });
    await post(other, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "ready", ready: true });
    await page.goto(`/rooms/${room.code}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("room-connection")).toHaveText("Connected");
    await other.goto(`/rooms/${room.code}`, { waitUntil: "domcontentloaded" });
    await expect(other.getByTestId("room-connection")).toHaveText("Connected");
    await post(page, `/rooms/${room.code}/commands`, { id: crypto.randomUUID(), kind: "start" });
    await expect(other.getByTestId("skip-song")).toBeVisible();
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(other.getByText("A listener disconnected. Their place is held for 30 seconds.", { exact: true })).toBeVisible();
    await expect(other.getByRole("heading", { name: "You win.", exact: true })).toBeVisible({ timeout: 45000 });
    await expect(other.getByText("Your opponent left or disconnected.", { exact: true })).toBeVisible();
    const rows = other.getByTestId("room-results").getByRole("row");
    await expect(rows.nth(1).getByRole("cell").nth(0)).toHaveText("1");
    await expect(rows.nth(1).getByRole("cell").nth(1)).toContainText(winner.nickname);
    await expect(rows.nth(2).getByRole("cell").nth(0)).toHaveText("2");
    await expect(rows.nth(2).getByRole("cell").nth(1)).toContainText(host.nickname);
    await expect(other.getByText("A listener disconnected. Their place is held for 30 seconds.", { exact: true })).toHaveCount(0);
    await noOverflow(other);
    await other.screenshot({ path: `design/runtime-duel-forfeit-${info.project.name}.png`, fullPage: true });
  } finally {
    await otherContext.close();
  }
});
test("profile updates and server-backed leaderboards", async ({ page }) => {
  await page.goto("/profile", { waitUntil: "domcontentloaded" }); await page.getByLabel("Display name").fill("QA Listener"); await page.getByRole("button", { name: /Save/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible(); await page.reload({ waitUntil: "domcontentloaded" }); await expect(page.getByLabel("Display name")).toHaveValue("QA Listener");
  await page.goto("/leaderboard", { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading", { name: "A little friendly competition." })).toBeVisible(); await noOverflow(page);
});
