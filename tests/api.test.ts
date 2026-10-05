import { describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { app } from "../src/server/api";
import { getStore } from "../src/server/atomic-store";
import { organizeCatalog, searchCatalog } from "../src/server/catalog";
import * as provider from "../src/server/audius";
import * as database from "../src/server/db";
import { getPool } from "../src/server/db";
import { createSoloGame } from "../src/server/game-engine";
import type { SoloSession } from "../src/server/game-service";
import { getRedis, redisKey } from "../src/server/redis";
import { ADMIN_COOKIE, createGuest, GUEST_COOKIE } from "../src/server/sessions";
import { hashToken } from "../src/server/security";
import { packs, packTracks, tracks } from "../src/server/schema";
import * as schema from "../src/server/schema";
import type { Track } from "../src/shared/contracts";

const catalogSong = (id: string, changes: Partial<Track> = {}): Track => ({
  id, providerId: id, title: `Song ${id}`, artist: "A test artist", artworkUrl: null, duration: 180,
  genre: "Pop", releaseYear: 2025, language: null, playCount: 100, clipStartSec: 0,
  sourceUrl: `https://audius.co/tracks/${id}`, license: null, available: true, ...changes,
});

async function catalogApiFixture() {
  const client = await PGlite.create();
  await client.exec(await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  await client.exec(await readFile(new URL("../migrations/0002_popularity_score.sql", import.meta.url), "utf8"));
  const db = drizzle(client, { schema });
  const catalogDb = db as unknown as ReturnType<typeof database.getDatabase>;
  const token = randomUUID();
  await client.query("INSERT INTO admin_sessions(token_hash,expires_at) VALUES($1,$2)", [hashToken(token), new Date(Date.now() + 60_000)]);
  const databaseFixture = spyOn(database, "getDatabase").mockReturnValue(catalogDb);
  // Run the real API, auth checks, SQL, and organizer against an isolated PostgreSQL adapter.
  const poolFixture = spyOn(database, "getPool").mockReturnValue({ query: (sql: string, params?: unknown[]) => client.query(sql, params) } as unknown as ReturnType<typeof getPool>);
  const headers = { Cookie: `${ADMIN_COOKIE}=${token}`, Origin: "http://127.0.0.1:3000", "Content-Type": "application/json" };
  const close = async () => { poolFixture.mockRestore(); databaseFixture.mockRestore(); await client.close(); };
  return { db, catalogDb, headers, close };
}

describe("catalog mutations through the admin API", () => {
  test("imports into the global mix also populate genre and decade collections", async () => {
    const fixture = await catalogApiFixture();
    const providerFixture = spyOn(provider, "getAudiusTrack").mockResolvedValue(catalogSong("imported-rock", { genre: "Rock", releaseYear: 2015 }));
    try {
      const response = await app.request("http://127.0.0.1:3000/api/v1/admin/import", { method: "POST", headers: fixture.headers, body: JSON.stringify({ trackIds: ["imported-rock"], packId: "global-mix" }) });
      expect(response.status).toBe(200);
      expect((await response.json()).imported).toBe(1);
      for (const packId of ["global-mix", "rock", "2010s", "popular"]) {
        expect((await searchCatalog({ packId }, fixture.catalogDb)).map(track => track.id)).toEqual(["imported-rock"]);
      }
    } finally { providerFixture.mockRestore(); await fixture.close(); }
  }, 30000);

  test("genre and release-year edits replace old memberships and keep custom selections", async () => {
    const fixture = await catalogApiFixture();
    try {
      await fixture.db.insert(tracks).values(catalogSong("edited"));
      await fixture.db.insert(packs).values({ id: "custom", slug: "custom", name: "Custom", description: "Selected songs", coverArt: "global" });
      await fixture.db.insert(packTracks).values({ packId: "custom", trackId: "edited" });
      await organizeCatalog(fixture.catalogDb);
      const response = await app.request("http://127.0.0.1:3000/api/v1/admin/tracks/edited", { method: "PATCH", headers: fixture.headers, body: JSON.stringify({ genre: "Rock", releaseYear: 2015 }) });
      expect(response.status).toBe(200);
      const membership = (await fixture.db.select().from(packTracks).where(eq(packTracks.trackId, "edited"))).map(row => row.packId).sort();
      expect(membership).toEqual(["2010s", "custom", "global-mix", "popular", "rock"]);
    } finally { await fixture.close(); }
  }, 30000);

  test("availability edits remove derived memberships while retaining the global library", async () => {
    const fixture = await catalogApiFixture();
    try {
      await fixture.db.insert(tracks).values(catalogSong("hidden"));
      await organizeCatalog(fixture.catalogDb);
      const response = await app.request("http://127.0.0.1:3000/api/v1/admin/tracks/hidden", { method: "PATCH", headers: fixture.headers, body: JSON.stringify({ available: false }) });
      expect(response.status).toBe(200);
      expect(await fixture.db.select().from(packTracks).where(eq(packTracks.trackId, "hidden"))).toEqual([{ packId: "global-mix", trackId: "hidden" }]);
    } finally { await fixture.close(); }
  }, 30000);

  test("rejects manual collection overrides with an actionable client error", async () => {
    const fixture = await catalogApiFixture();
    try {
      await fixture.db.insert(tracks).values(catalogSong("selected", { genre: "Rock" }));
      await organizeCatalog(fixture.catalogDb);
      for (const [method, path, body] of [
        ["POST", "/admin/packs/pop/tracks", { trackIds: ["selected"] }],
        ["DELETE", "/admin/packs/rock/tracks/selected", undefined],
      ] as const) {
        const response = await app.request(`http://127.0.0.1:3000/api/v1${path}`, { method, headers: fixture.headers, body: body ? JSON.stringify(body) : undefined });
        expect(response.status).toBe(400);
        const { error } = await response.json();
        expect(error.code).toBe("AUTOMATIC_COLLECTION");
        expect(error.message).toContain("custom pack");
      }
    } finally { await fixture.close(); }
  }, 30000);
});

function sampleMp3() {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 11]);
  return Buffer.concat([tag, Buffer.from("secret-name"), ...Array.from({ length: Math.ceil(20 * 44100 / 1152) }, () => frame)]);
}

describe("protected HTTP API", () => {
  test("public discovery returns live packs", async () => {
    const response = await app.request("http://127.0.0.1:3000/api/v1/packs");
    expect(response.status).toBe(200);
    expect((await response.json()).packs).toBeArray();
  });
  test("CSRF and unauthenticated catalog writes are rejected", async () => {
    const crossSite = await app.request("http://127.0.0.1:3000/api/v1/admin/packs", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://another-site.example" }, body: JSON.stringify({ name: "Test pack", description: "" }) });
    expect(crossSite.status).toBe(403);
    const anonymous = await app.request("http://127.0.0.1:3000/api/v1/admin/catalog");
    expect(anonymous.status).toBe(401);
  });
  test("a guest cookie resumes and invalid game input is handled", async () => {
    const response = await app.request("http://127.0.0.1:3000/api/v1/guest");
    expect(response.status).toBe(200);
    const guest = (await response.json()).guest;
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0];
    expect(cookie).toContain("gts_guest=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    const resumed = await app.request("http://127.0.0.1:3000/api/v1/guest", { headers: { Cookie: cookie } });
    expect((await resumed.json()).guest.id).toBe(guest.id);
    const invalid = await app.request("http://127.0.0.1:3000/api/v1/games", { method: "POST", headers: { Cookie: cookie, Origin: "http://127.0.0.1:3000", "Content-Type": "application/json" }, body: JSON.stringify({ mode: "invented" }) });
    expect(invalid.status).toBe(400);
  });

  test("opaque Blitz audio serves sixteen seconds after every automatic song change", async () => {
    const { guest, token } = await createGuest();
    const id = randomUUID();
    const key = `solo:${id}`;
    const tracks = (await searchCatalog({ limit: 3 })).map((track, index) => ({ ...track, providerId: `test-blitz-${id}-${index}` }));
    const cacheKeys = tracks.map(track => redisKey(`audio:${track.providerId}:0:16`));
    const headers = { Cookie: `${GUEST_COOKIE}=${token}` };
    const origin = "http://127.0.0.1:3000";
    const expectedLength = Math.floor(16 * 44100 / 1152) * 417;
    const source = sampleMp3();
    const originalFetch = globalThis.fetch;
    const fetchFixture = Object.assign((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "api.audius.co" && tracks.some(track => url.pathname === `/v1/tracks/${track.providerId}/stream`)) {
        return Promise.resolve(new Response(source, { headers: { "Content-Type": "audio/mpeg" } }));
      }
      return originalFetch(input, init);
    }, { preconnect: originalFetch.preconnect });
    const providerFetch = spyOn(globalThis, "fetch").mockImplementation(fetchFixture);
    try {
      expect(tracks).toHaveLength(3);
      await getStore().create<SoloSession>(key, { guestId: guest.id, dailyDate: null, game: createSoloGame({ id, playerId: guest.id, mode: "blitz", tracks, now: Date.now(), packId: "global-mix", excerptMode: "start" }) });
      for (let round = 0; round < 4; round++) {
        const reply = await app.request(`${origin}/api/v1/games/${id}`, { headers });
        expect(reply.status).toBe(200);
        const { game } = await reply.json();
        const audio = await app.request(`${origin}${game.audioUrl}`, { headers });
        expect(audio.status).toBe(200);
        const bytes = Buffer.from(await audio.arrayBuffer());
        expect(bytes.length).toBe(expectedLength);
        expect(audio.headers.get("Content-Length")).toBe(String(expectedLength));
        expect(bytes.toString()).not.toContain("secret-name");
        const duration = bytes.length / 417 * 1152 / 44100;
        expect(duration).toBeGreaterThan(15.9);
        expect(duration).toBeLessThanOrEqual(16);
        expect(game.clipDurationSec).toBe(16);

        const partial = await app.request(`${origin}${game.audioUrl}`, { headers: { ...headers, Range: "bytes=417-833" } });
        expect(partial.status).toBe(206);
        expect(partial.headers.get("Content-Range")).toBe(`bytes 417-833/${expectedLength}`);
        expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(417, 834));
        const pastEnd = await app.request(`${origin}${game.audioUrl}`, { headers: { ...headers, Range: `bytes=${expectedLength}-` } });
        expect(pastEnd.status).toBe(416);
        expect(pastEnd.headers.get("Content-Range")).toBe(`bytes */${expectedLength}`);

        if (round === 3) break;
        const command = round === 0 ? { kind: "guess", trackId: tracks[2].id } : round === 1 ? { kind: "skip" } : { kind: "guess", trackId: tracks[2].id };
        const advanced = await app.request(`${origin}/api/v1/games/${id}/commands`, { method: "POST", headers: { ...headers, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ id: randomUUID(), ...command }) });
        expect(advanced.status).toBe(200);
      }
    } finally {
      providerFetch.mockRestore();
      await getStore().remove(key);
      await getRedis().del(...cacheKeys, ...tracks.map(track => redisKey(`audio:${track.providerId}:0:1`)), redisKey(`rate:guest:${guest.id}`));
      await getPool().query("DELETE FROM game_results WHERE guest_id=$1", [guest.id]);
      await getPool().query("DELETE FROM guests WHERE id=$1", [guest.id]);
    }
  });
});
