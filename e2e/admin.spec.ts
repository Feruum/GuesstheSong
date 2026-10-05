import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { catalogTrack } from "../src/server/catalog";
import { getPool } from "../src/server/db";

test.use({ trace: "off" });
test("admin protection, metadata editing, live Audius import and pack creation", async ({ page }) => {
  const password = (await readFile(".data/admin-password.txt", "utf8")).trim();
  expect((await page.request.get("/api/v1/admin/catalog")).status()).toBe(401);
  const login = await page.request.post("/api/v1/admin/login", { headers: { Origin: "http://127.0.0.1:3000" }, data: { password } });
  expect(login.ok()).toBe(true);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Make a good collection." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const original = (await catalogTrack("audius-G0wyE"))!;
  let createdPack: string | undefined;
  const headers = { Origin: "http://127.0.0.1:3000" };
  try {
    await page.getByRole("textbox", { name: "Search catalog", exact: true }).fill(original.title);
    await page.getByRole("button", { name: "Search catalog", exact: true }).click();
    await page.getByRole("button", { name: `Edit ${original.title}`, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByLabel("Excerpt start · seconds").fill("20");
    await page.getByRole("button", { name: "Save song", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await catalogTrack(original.id))?.clipStartSec).toBe(20);
    const invalid = await page.request.patch(`/api/v1/admin/tracks/${original.id}`, { headers, data: { clipStartSec: original.duration } }); expect(invalid.status()).toBe(400);
    const imported = await page.request.post("/api/v1/admin/import", { headers, data: { trackIds: [original.providerId], packId: "global-mix" } });
    expect(imported.ok()).toBe(true); expect((await imported.json()).imported).toBe(1); expect((await catalogTrack(original.id))?.clipStartSec).toBe(20);
    await page.getByRole("tab", { name: "Import from Audius" }).click();
    await page.getByLabel("Search Audius songs").fill("Skrillex");
    await page.getByRole("button", { name: "Search Audius", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: /^Import / }).first()).toBeVisible({ timeout: 25000 });
    await page.getByRole("tab", { name: "Music packs" }).click();
    await page.getByRole("button", { name: "Create pack", exact: true }).click();
    await page.getByLabel("Pack name").fill("QA listening collection");
    await page.getByLabel("Description").fill("A temporary integration test collection.");
    const saved = page.waitForResponse(response => response.url().endsWith("/api/v1/admin/packs") && response.request().method() === "POST");
    await page.getByRole("dialog").getByRole("button", { name: "Create pack", exact: true }).click();
    const pack = (await (await saved).json()).pack; createdPack = pack.id;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "QA listening collection" })).toBeVisible();
    const assigned = await page.request.post(`/api/v1/admin/packs/${pack.id}/tracks`, { headers, data: { trackIds: [original.id] } }); expect(assigned.ok()).toBe(true);
    const removed = await page.request.delete(`/api/v1/admin/packs/${pack.id}/tracks/${original.id}`, { headers }); expect(removed.ok()).toBe(true);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByTestId("admin-login")).toBeVisible();
    expect((await page.request.get("/api/v1/admin/catalog")).status()).toBe(401);
  } finally {
    await getPool().query("UPDATE tracks SET clip_start_sec=$2 WHERE id=$1", [original.id, original.clipStartSec]);
    if (createdPack) { await getPool().query("DELETE FROM pack_tracks WHERE pack_id=$1", [createdPack]); await getPool().query("DELETE FROM packs WHERE id=$1", [createdPack]); }
  }
});
