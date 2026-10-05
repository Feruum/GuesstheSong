import { expect, test } from "@playwright/test";

const guest = { id: "ec818cf6-a39e-4ce4-a397-a950a35e79d0", nickname: "Hydration listener", avatar: 2 };

test("a cached guest enables Duel controls when its route hydrates after the header", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let routeHeld = false;
  let matchmakingCalls = 0;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/guest", route => route.fulfill({ json: { guest } }));
  // Keep the server-rendered route unhydrated until the shared guest cache has data.
  await page.route(/\/_next\/static\/chunks\/app\/duel\/page-[^/?]+\.js(?:\?.*)?$/, async route => {
    routeHeld = true;
    await held;
    await route.continue();
  });
  await page.route("**/api/v1/matchmaking", route => {
    if (route.request().method() === "POST") matchmakingCalls++;
    return route.fulfill({ json: { status: "waiting" } });
  });
  try {
    await page.goto("/duel", { waitUntil: "commit" });
    await expect.poll(() => routeHeld).toBe(true);
    await expect(page.locator(".profile-link")).toHaveAccessibleName(`${guest.nickname}, your profile`);
    await expect(page.getByRole("button", { name: "Find an opponent" })).toBeDisabled();
    expect(matchmakingCalls).toBe(0);
    release();
    for (const name of ["Find an opponent", "Create room", "Join room"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    }
    await page.getByRole("button", { name: "Find an opponent" }).click();
    await expect(page.getByRole("button", { name: "Cancel search" })).toBeVisible();
    await expect.poll(() => matchmakingCalls).toBe(1);
    await page.getByRole("button", { name: "Cancel search" }).click();
    await expect(page.getByRole("button", { name: "Find an opponent" })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally { release(); }
});

test("Duel keeps guest controls disabled during loading and errors, then recovers on retry", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let recover = false;
  await page.route("**/api/v1/guest", async route => {
    requests++;
    if (recover) return route.fulfill({ json: { guest } });
    await held;
    return route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Guest service is temporarily unavailable." } } });
  });
  try {
    await page.goto("/duel", { waitUntil: "domcontentloaded" });
    await expect.poll(() => requests).toBeGreaterThan(0);
    for (const name of ["Find an opponent", "Create room", "Join room"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    release();
    const error = page.getByRole("alert").filter({ hasText: "Couldn’t open your guest profile." });
    await expect(error).toBeVisible();
    await expect(page.getByRole("button", { name: "Find an opponent" })).toBeDisabled();
    recover = true;
    await error.getByRole("button", { name: "Try again" }).click();
    await expect(error).toHaveCount(0);
    await expect(page.locator(".profile-link")).toHaveAccessibleName(`${guest.nickname}, your profile`);
    for (const name of ["Find an opponent", "Create room", "Join room"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
    }
  } finally { release(); }
});
