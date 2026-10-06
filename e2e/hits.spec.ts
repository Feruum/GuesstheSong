import { expect, test } from "@playwright/test";
import { getStore } from "../src/server/atomic-store";
import { catalogTrack } from "../src/server/catalog";
import type { SoloSession } from "../src/server/game-service";

test("familiar artists, explicit genres, deep catalog pagination, and the primary game", async ({ page }, info) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const genres = page.getByTestId("collections-genre");
  for (const name of ["Pop", "Hip-hop", "Rock", "Indie & alternative", "R&B & soul", "Jazz", "Latin", "Metal", "Country", "Reggae", "Classical", "House"]) {
    await expect(genres.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator('a[href="/packs/featured-hits"]')).toContainText("100 hitmakers");
  const catalog = await (await page.request.get("/api/v1/catalog/search?packId=hits&offset=2001&limit=10")).json();
  expect(catalog.tracks).toHaveLength(10);
  expect(catalog.tracks.every((track: { id: string }) => track.id.startsWith("deezer-"))).toBe(true);
  const known = await (await page.request.get("/api/v1/catalog/search?q=Blinding%20Lights&packId=hits&limit=10")).json();
  expect(known.tracks.some((track: { artist: string; title: string }) => track.artist === "The Weeknd" && track.title === "Blinding Lights")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await genres.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `design/runtime-genres-${info.project.name}.png`, fullPage: true });
  await page.getByRole("link", { name: "Start guessing", exact: true }).click();
  await expect(page).toHaveURL(/pack=featured-hits/);
  await expect(page.getByRole("combobox", { name: "Music pack", exact: true })).toContainText("100 hitmakers");
  const started = page.waitForResponse(response => response.url().endsWith("/api/v1/games") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Let's play" }).click();
  expect((await (await started).json()).game.packId).toBe("featured-hits");
  await expect(page.getByTestId("solo-game")).toHaveAttribute("data-state", "playing");
});

test("an original hit plays through the opaque staged endpoint, guesses correctly, and credits Deezer", async ({ page }, info) => {
  await page.request.get("/api/v1/guest");
  const matches = await (await page.request.get("/api/v1/catalog/search?q=Blinding%20Lights&packId=hits&limit=10")).json();
  const match = matches.tracks.find((track: { artist: string; title: string }) => track.artist === "The Weeknd" && track.title === "Blinding Lights");
  expect(match).toBeTruthy();
  const track = await catalogTrack(match.id);
  const started = await page.request.post("/api/v1/games", { headers: { Origin: "http://127.0.0.1:3000" }, data: { mode: "classic", packId: "hits", difficulty: 0, excerptMode: "curated" } });
  expect(started.ok()).toBe(true);
  const { game } = await started.json();
  await getStore().update<SoloSession>(`solo:${game.id}`, value => ({ ...value, game: { ...value.game, tracks: [track!, ...value.game.tracks.filter(song => song.id !== track!.id)].slice(0, 10) } }));
  await page.goto(`/play/classic/${game.id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("solo-game")).not.toContainText("Blinding Lights");
  await page.evaluate(() => {
    const nativePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as Window & { qaSongAudio?: HTMLMediaElement }).qaSongAudio = this;
      return nativePlay.call(this);
    };
  });
  await page.getByTestId("play-clip").click();
  await expect.poll(() => page.evaluate(() => {
    const audio = (window as Window & { qaSongAudio?: HTMLMediaElement }).qaSongAudio;
    return !!audio && audio.readyState >= 3 && audio.currentTime > 0 && !audio.error;
  }), { timeout: 25000 }).toBe(true);
  expect(await page.evaluate(() => (window as Window & { qaSongAudio?: HTMLMediaElement }).qaSongAudio!.duration)).toBeLessThanOrEqual(1.05);
  await page.getByTestId("skip-song").click();
  await expect(page.getByTestId("play-clip")).toHaveAccessibleName("Play 2-second clip");
  await page.getByTestId("play-clip").click();
  await expect.poll(() => page.evaluate(() => {
    const audio = (window as Window & { qaSongAudio?: HTMLMediaElement }).qaSongAudio;
    return !!audio && audio.readyState >= 3 && audio.currentTime > 0 && audio.duration > 1 && audio.duration <= 2.05 && !audio.error;
  }), { timeout: 25000 }).toBe(true);
  await page.getByLabel("Search a song or artist").fill("Blinding Lights");
  await page.getByRole("option").filter({ hasText: "The Weeknd" }).first().click();
  await page.getByTestId("submit-guess").click();
  const reveal = page.getByTestId("track-reveal");
  await expect(reveal).toContainText("Blinding Lights");
  await expect(reveal).toContainText("+80 points");
  await expect(reveal.getByRole("link", { name: "Listen on Deezer" })).toHaveAttribute("href", track!.sourceUrl);
  await expect(reveal).not.toContainText("Open Music License");
  await expect.poll(() => reveal.locator("img").evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0), { timeout: 15000 }).toBe(true);
  await page.getByRole("button", { name: "Next song", exact: true }).focus();
  await reveal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `design/runtime-hit-reveal-${info.project.name}.png`, fullPage: true });
});

test("genre filters play the chosen genre and Chart Clash offers Audius collections", async ({ page }) => {
  await page.goto("/?genre=Pop", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Play Pop", exact: true })).toHaveAttribute("href", "/play/classic?pack=pop");
  await page.getByRole("link", { name: "Play Pop", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Music pack", exact: true })).toContainText("Pop");
  await page.goto("/play/chart", { waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Music pack", exact: true }).click();
  await expect(page.getByRole("option", { name: /Hits & familiar artists/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Let's play" }).click();
  await expect(page.getByTestId("solo-game")).toHaveAttribute("data-mode", "chart");
  await expect(page.locator(".chart-card").first()).toContainText("Audius");
});
