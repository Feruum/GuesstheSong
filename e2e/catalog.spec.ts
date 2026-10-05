import { expect, test } from "@playwright/test";

test("clearing catalog filters resets the visible inputs and the next search", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Search songs or artists" }).fill("love");
  await page.getByRole("combobox", { name: "Genre", exact: true }).selectOption("Pop");
  await page.getByRole("combobox", { name: "Decade", exact: true }).selectOption("2020");
  await page.getByRole("button", { name: "Find music" }).click();
  await expect(page).toHaveURL(/genre=Pop.*decade=2020/);
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3000/");
  await expect(page.getByRole("textbox", { name: "Search songs or artists" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Genre", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Decade", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Find music" }).click();
  await expect(page.locator('a[href="/packs/global-mix"]')).toBeVisible();
  await expect(page.getByTestId("catalog-results")).toHaveCount(0);
});

test("genre and decade collections lead to games with the selected music pack", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "By genre", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Through the decades", exact: true })).toBeVisible();
  const packs = (await (await page.request.get("/api/v1/packs")).json()).packs as { id: string; count: number; name: string }[];
  for (const id of ["hip-hop", "pop", "rock", "indie", "2010s", "2020s"]) {
    const pack = packs.find(item => item.id === id);
    expect(pack, `${id} is available`).toBeTruthy();
    expect(pack!.count, `${id} has enough songs for Classic`).toBeGreaterThanOrEqual(10);
    await expect(page.locator(`a[href="/packs/${id}"]`)).toBeVisible();
  }
  for (const id of ["pop", "rock", "2010s"]) {
    await page.goto(`/packs/${id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Play this pack" }).click();
    const pack = packs.find(item => item.id === id)!;
    await expect(page.getByRole("combobox", { name: "Music pack", exact: true })).toContainText(pack.name);
    const started = page.waitForResponse(response => response.url().endsWith("/api/v1/games") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Let's play" }).click();
    const response = await started;
    expect(response.ok()).toBe(true);
    expect((await response.json()).game.packId).toBe(id);
    await expect(page.getByTestId("solo-game")).toHaveAttribute("data-state", "playing");
  }
});

test("missing provider artwork falls back in catalog rows and Chart Clash", async ({ page }) => {
  const catalog = await (await page.request.get("/api/v1/catalog/search?packId=electronic&limit=20")).json();
  const track = catalog.tracks.find((item: { artworkUrl: string | null }) => item.artworkUrl) as { title: string; artworkUrl: string };
  expect(track).toBeTruthy();
  await page.route(track.artworkUrl, route => route.fulfill({ status: 404, body: "Missing artwork" }));
  await page.goto("/packs/electronic", { waitUntil: "domcontentloaded" });
  const row = page.locator(".track-row").filter({ hasText: track.title }).first();
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByTestId("artwork-fallback")).toBeVisible();
  await expect(row.locator("img")).toHaveCount(0);

  await page.request.get("/api/v1/guest");
  const started = await page.request.post("/api/v1/games", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: { mode: "chart", packId: "global-mix", difficulty: 0, excerptMode: "curated" },
  });
  expect(started.ok()).toBe(true);
  const { game } = await started.json();
  const baseline = game.comparison.baseline;
  expect(baseline.artworkUrl).toBeTruthy();
  await page.route(baseline.artworkUrl, route => route.fulfill({ status: 404, body: "Missing artwork" }));
  await page.goto(`/play/chart/${game.id}`, { waitUntil: "domcontentloaded" });
  const benchmark = page.locator(".chart-card").first();
  await expect(benchmark.getByRole("heading", { name: baseline.title, exact: true })).toBeVisible();
  await expect(benchmark.getByTestId("artwork-fallback")).toBeVisible();
  await expect(benchmark.locator("img")).toHaveCount(0);
});
