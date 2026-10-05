import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { LocalPgWireServer } from "../scripts/local-pgwire-queue";
import { initializeDeploymentDatabase, parsePublicCatalog, deploymentConfigurationIssues } from "../scripts/deployment";
import * as schema from "../src/server/schema";
import { organizeCatalog, searchCatalog } from "../src/server/catalog";
import type { Track } from "../src/shared/contracts";

const track = (id: string, changes: Partial<Track> = {}): Track => ({
  id: `audius-${id}`, providerId: id, title: `Song ${id}`, artist: "Audius artist",
  artworkUrl: null, duration: 180, genre: "Pop", releaseYear: 2015, language: null,
  playCount: 100, popularityScore: 0, clipStartSec: 0, sourceUrl: `https://audius.co/tracks/${id}`,
  license: "CC BY", available: true, ...changes,
});
const starter = { version: 1, tracks: [track("first"), track("second", { genre: "Rock" })] };
const migrations = await Promise.all((await readdir(new URL("../migrations/", import.meta.url)))
  .filter(name => /^\d+.*\.sql$/.test(name)).sort()
  .map(async name => ({ name, source: await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8") })));

async function isolatedDatabase() {
  const client = await PGlite.create();
  const server = new LocalPgWireServer({ db: client, host: "127.0.0.1", port: 0, maxConnections: 4 });
  await server.start();
  const pool = new Pool({ host: "127.0.0.1", port: Number(server.getServerConn().split(":").at(-1)), user: "postgres", database: "postgres", max: 2 });
  const db = drizzle(pool, { schema });
  return { client, db, deploymentDb: db, close: async () => { await pool.end(); await server.stop(); await client.close(); } };
}

describe("production deployment preparation", () => {
  test("the deploy command stops before connecting when configuration is missing", () => {
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "scripts/prepare-deployment.ts"], {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, DATABASE_URL: "", REDIS_URL: "", SESSION_SECRET: "", APP_URL: "" },
      stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("DATABASE_URL must be a cloud PostgreSQL URL with TLS.");
    expect(result.stderr.toString()).not.toContain("The song catalog isn't connected yet.");
  });

  test("reports missing configuration names without exposing credentials", () => {
    expect(deploymentConfigurationIssues({})).toEqual([
      "DATABASE_URL must be a cloud PostgreSQL URL with TLS.",
      "REDIS_URL must be a cloud Redis TCP/TLS URL (rediss://).",
      "SESSION_SECRET must contain at least 32 characters.",
      "APP_URL must be the exact public HTTPS origin.",
    ]);
    const invalid = {
      DATABASE_URL: "postgres://secret-user:do-not-print@localhost/music",
      REDIS_URL: "https://do-not-print.upstash.io",
      SESSION_SECRET: "do-not-print",
      APP_URL: "http://127.0.0.1:3000",
    };
    expect(deploymentConfigurationIssues(invalid)).toHaveLength(4);
    expect(deploymentConfigurationIssues(invalid).join(" ")).not.toContain("do-not-print");
    expect(deploymentConfigurationIssues({
      DATABASE_URL: "postgresql://user:password@database.neon.tech/music?sslmode=require",
      REDIS_URL: "rediss://default:password@redis.upstash.io:6379",
      SESSION_SECRET: "a-secure-random-value-over-32-characters", APP_URL: "https://music.vercel.app",
    })).toEqual([]);
  });

  test("rejects private previews and restricted or malformed starter metadata", () => {
    expect(parsePublicCatalog(starter)).toEqual(starter.tracks);
    for (const invalid of [
      track("private", { id: "deezer-123", providerId: "deezer:123" }),
      track("private", { license: "CC BY-NC" }), track("private", { available: false }),
      track("private", { clipStartSec: 179 }), track("private", { sourceUrl: "https://example.com" }),
    ]) expect(() => parsePublicCatalog({ version: 1, tracks: [invalid] })).toThrow("public Audius metadata");
    expect(() => parsePublicCatalog({ version: 1, tracks: [track("first"), track("first")] })).toThrow("public Audius metadata");
  });

  test("creates a fresh playable catalog including genre and decade membership", async () => {
    const fixture = await isolatedDatabase();
    try {
      const result = await initializeDeploymentDatabase(fixture.deploymentDb, migrations, starter);
      expect(result).toEqual({ seeded: 2, playable: 2 });
      expect((await searchCatalog({ packId: "pop" }, fixture.deploymentDb)).map(song => song.id)).toEqual(["audius-first"]);
      expect((await searchCatalog({ packId: "rock" }, fixture.deploymentDb)).map(song => song.id)).toEqual(["audius-second"]);
      expect(await searchCatalog({ packId: "2010s" }, fixture.deploymentDb)).toHaveLength(2);
    } finally { await fixture.close(); }
  }, 30000);

  test("subsequent deployments preserve edits, disabled songs and manual collections", async () => {
    const fixture = await isolatedDatabase();
    try {
      await initializeDeploymentDatabase(fixture.deploymentDb, migrations, starter);
      await fixture.db.update(schema.tracks).set({ title: "Admin correction", genre: "Jazz", available: false }).where(eq(schema.tracks.id, "audius-first"));
      await fixture.db.insert(schema.packs).values({ id: "curated", slug: "curated", name: "Curated", description: "Hand-picked", coverArt: "global" });
      await fixture.db.insert(schema.packTracks).values({ packId: "curated", trackId: "audius-second" });
      await organizeCatalog(fixture.deploymentDb);
      expect(await initializeDeploymentDatabase(fixture.deploymentDb, migrations, { version: 1, tracks: [...starter.tracks, track("new")] })).toEqual({ seeded: 0, playable: 1 });
      const [edited] = await fixture.db.select().from(schema.tracks).where(eq(schema.tracks.id, "audius-first"));
      expect([edited.title, edited.genre, edited.available]).toEqual(["Admin correction", "Jazz", false]);
      expect(await searchCatalog({ packId: "curated" }, fixture.deploymentDb)).toHaveLength(1);
    } finally { await fixture.close(); }
  }, 30000);

  test("a failed initialization rolls back the entire catalog and can be retried", async () => {
    const fixture = await isolatedDatabase();
    try {
      await expect(initializeDeploymentDatabase(fixture.deploymentDb, [...migrations, { name: "9999_failure.sql", source: "SELECT missing_deployment_function()" }], starter)).rejects.toThrow();
      const tables = await fixture.client.query<{ count: number }>("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public'");
      expect(tables.rows[0].count).toBe(0);
      expect(await initializeDeploymentDatabase(fixture.deploymentDb, migrations, starter)).toEqual({ seeded: 2, playable: 2 });
    } finally { await fixture.close(); }
  }, 30000);

  test("two deployment workers seed the database once", async () => {
    const fixture = await isolatedDatabase();
    try {
      const results = await Promise.all([
        initializeDeploymentDatabase(fixture.deploymentDb, migrations, starter),
        initializeDeploymentDatabase(fixture.deploymentDb, migrations, starter),
      ]);
      expect(results.map(result => result.seeded).sort()).toEqual([0, 2]);
      expect(await fixture.db.select().from(schema.tracks)).toHaveLength(2);
    } finally { await fixture.close(); }
  }, 30000);

  test("the committed starter catalog initializes all 1500 public songs", async () => {
    const input = JSON.parse(await readFile(new URL("../catalog/audius-starter.json", import.meta.url), "utf8"));
    const songs = parsePublicCatalog(input);
    expect(songs).toHaveLength(1500);
    expect(songs.every(song => song.id.startsWith("audius-") && song.available)).toBe(true);
    for (const genre of ["Pop", "Rock", "Alternative", "Hip-Hop/Rap"]) {
      expect(songs.filter(song => song.genre === genre).length).toBeGreaterThanOrEqual(10);
    }
    const fixture = await isolatedDatabase();
    try {
      expect(await initializeDeploymentDatabase(fixture.deploymentDb, migrations, input)).toEqual({ seeded: 1500, playable: 1500 });
      const imported = await searchCatalog({ packId: "global-mix", limit: 2000 }, fixture.deploymentDb);
      expect(new Set(imported.map(song => song.id))).toEqual(new Set(songs.map(song => song.id)));
    } finally { await fixture.close(); }
  }, 30000);
});
