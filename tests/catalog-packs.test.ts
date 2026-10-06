import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { attachToPack, importTracks, listPacks, organizeCatalog, refreshCatalog, removePackTrack, searchCatalog, seedCatalog, selectPool } from "../src/server/catalog";
import { ProviderError } from "../src/server/audius";
import { getDatabase } from "../src/server/db";
import { packs, packTracks, tracks } from "../src/server/schema";
import * as schema from "../src/server/schema";
import { DEFAULT_PACKS, selectPackTracks, countGenrePacks } from "../src/server/catalog-packs";
import type { Track } from "../src/shared/contracts";

const song = (id: string, change: Partial<Track> = {}): Track => ({
  id, providerId: id, title: `Song ${id}`, artist: "An Audius artist", artworkUrl: null,
  duration: 180, genre: null, releaseYear: null, language: null, playCount: 100,
  clipStartSec: 0, sourceUrl: `https://audius.co/tracks/${id}`, license: null, available: true,
  ...change,
});
const ids = (songs: Track[]) => songs.map(track => track.id);

async function memoryCatalog() {
  const client = await PGlite.create();
  await client.exec(await readFile(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  await client.exec(await readFile(new URL("../migrations/0002_popularity_score.sql", import.meta.url), "utf8"));
  const db = drizzle(client, { schema });
  // Both adapters execute the same PostgreSQL dialect; the test uses an isolated, in-memory database.
  const catalogDb = db as unknown as ReturnType<typeof getDatabase>;
  return { client, db, catalogDb };
}

describe("automatic catalog pack definitions", () => {
  test("keeps the starter pack IDs and adds distinct genre, decade, and popularity packs", () => {
    expect(DEFAULT_PACKS.map(pack => pack.id)).toEqual([
      "global-mix", "electronic", "hip-hop", "indie", "pop", "rock", "2010s", "2020s", "popular", "hits", "hits-2010s", "rnb", "house", "jazz", "latin", "metal", "country", "reggae", "classical", "1980s", "1990s", "2000s", "featured-hits",
    ]);
    expect(DEFAULT_PACKS.find(pack => pack.id === "pop")?.genre).toBe("Pop");
    expect(DEFAULT_PACKS.find(pack => pack.id === "rock")?.genre).toBe("Rock");
    expect(DEFAULT_PACKS.find(pack => pack.id === "popular")?.description).toContain("current Audius play counts");
  });

  test("provides simple kinds for grouped discovery without new artwork variants", () => {
    expect(DEFAULT_PACKS.filter(pack => pack.kind === "decade").map(pack => pack.id)).toEqual(["2010s", "2020s", "hits-2010s", "1980s", "1990s", "2000s"]);
    expect(DEFAULT_PACKS.filter(pack => pack.kind === "genre").map(pack => pack.id)).toEqual(["electronic", "hip-hop", "indie", "pop", "rock", "rnb", "house", "jazz", "latin", "metal", "country", "reggae", "classical"]);
    expect(DEFAULT_PACKS.every(pack => ["global", "electronic", "hip-hop", "indie"].includes(pack.coverArt))).toBe(true);
  });
});

describe("metadata-based automatic pack membership", () => {
  test("keeps official previews out of Audius play-count rankings", () => {
    const songs = [song("audius-original", { genre: "Pop", playCount: 100 }), song("deezer-123", { genre: "Pop", playCount: 0, releaseYear: 2016 })];
    expect(ids(selectPackTracks("hits", songs))).toEqual(["deezer-123"]);
    expect(ids(selectPackTracks("hits-2010s", songs))).toEqual(["deezer-123"]);
    expect(ids(selectPackTracks("popular", songs))).toEqual(["audius-original"]);
    expect(selectPackTracks("hits-2010s", [song("deezer-124", { releaseYear: 2021 })])).toEqual([]);
  });

  test("organizes the additional genres from exact provider tags", () => {
    const songs = ["R&B/Soul", "Soul", "House", "Deep House", "Jazz", "Latin", "Metal", "Country", "Reggae", "Classical"].map(genre => song(genre, { genre }));
    for (const [id, count] of [["rnb", 2], ["house", 2], ["jazz", 1], ["latin", 1], ["metal", 1], ["country", 1], ["reggae", 1], ["classical", 1]] as const) {
      expect(selectPackTracks(id, songs)).toHaveLength(count);
    }
  });
  const genres = ["Pop", "Rock", "Alternative", "Indie", "Folk", "Acoustic", "Hip-Hop/Rap", "Hip-Hop", "Rap", "Electronic", "House", "Trap", "Jazz", "Indie Pop", "Pop/Rock"];
  const catalog = genres.map((genre, index) => song(String(index).padStart(2, "0"), { genre }));

  test("keeps Pop and Rock out of the indie and alternative collection", () => {
    expect(selectPackTracks("pop", catalog).map(track => track.genre)).toEqual(["Pop"]);
    expect(selectPackTracks("rock", catalog).map(track => track.genre)).toEqual(["Rock"]);
    expect(selectPackTracks("indie", catalog).map(track => track.genre)).toEqual(["Alternative", "Indie", "Folk", "Acoustic"]);
  });

  test("only includes matching hip-hop and electronic metadata", () => {
    expect(selectPackTracks("hip-hop", catalog).map(track => track.genre)).toEqual(["Hip-Hop/Rap", "Hip-Hop", "Rap"]);
    expect(selectPackTracks("electronic", catalog).map(track => track.genre)).toEqual(["Electronic", "House", "Trap"]);
  });

  test("does not infer a genre or release year from a title or unknown metadata", () => {
    const unknown = [song("unknown", { title: "Pop rock hits of the 2010s", genre: null, releaseYear: null })];
    for (const pack of ["pop", "rock", "indie", "hip-hop", "electronic", "2010s", "2020s"]) {
      expect(selectPackTracks(pack, unknown)).toEqual([]);
    }
    expect(ids(selectPackTracks("global-mix", unknown))).toEqual(["unknown"]);
    expect(ids(selectPackTracks("popular", unknown))).toEqual(["unknown"]);
  });

  test("uses inclusive decade starts and exclusive decade ends", () => {
    const years = [2009, 2010, 2019, 2020, 2029, 2030, null];
    const dated = years.map(year => song(String(year), { releaseYear: year }));
    expect(ids(selectPackTracks("2010s", dated))).toEqual(["2010", "2019"]);
    expect(ids(selectPackTracks("2020s", dated))).toEqual(["2020", "2029"]);
  });

  test("does not put unavailable tracks into automatic packs", () => {
    const unavailable = [song("hidden", { available: false, genre: "Pop", releaseYear: 2015, playCount: 1_000_000 })];
    for (const pack of DEFAULT_PACKS) expect(selectPackTracks(pack.id, unavailable)).toEqual([]);
  });

  test("ranks current plays descending with deterministic IDs for ties", () => {
    const input = [song("z", { playCount: 100 }), song("a", { playCount: 100 }), song("top", { playCount: 500 }), song("low", { playCount: 0 })];
    expect(ids(selectPackTracks("popular", input))).toEqual(["top", "a", "z", "low"]);
    expect(ids(input)).toEqual(["z", "a", "top", "low"]);
  });

  test("caps the popular pack at 200 and retains all genre and decade matches", () => {
    const input = Array.from({ length: 210 }, (_, index) => song(String(index).padStart(3, "0"), { genre: "Pop", releaseYear: 2015, playCount: index }));
    const popular = selectPackTracks("popular", input);
    expect(popular).toHaveLength(200);
    expect(popular[0].playCount).toBe(209);
    expect(popular[199].playCount).toBe(10);
    expect(selectPackTracks("pop", input)).toHaveLength(210);
    expect(selectPackTracks("2010s", input)).toHaveLength(210);
  });

  test("deduplicates candidates without removing distinct songs by one artist", () => {
    const first = song("first", { genre: "Pop" });
    expect(ids(selectPackTracks("pop", [first, song("second", { genre: "Pop" }), first]))).toEqual(["first", "second"]);
  });

  test("does not assign unknown pack IDs a global pool", () => {
    for (const id of ["admin-created", "constructor", "__proto__", "toString"]) expect(selectPackTracks(id, catalog)).toEqual([]);
  });

  test("counts only playable matching genres when balancing sparse imports", () => {
    expect(countGenrePacks([...catalog, song("unavailable-pop", { genre: "Pop", available: false }), catalog[0]])).toEqual({
      pop: 1, rock: 1, indie: 4, "hip-hop": 3,
    });
    expect(countGenrePacks([song("unknown")])).toEqual({ pop: 0, rock: 0, indie: 0, "hip-hop": 0 });
  });
});

describe("large and private catalogs", () => {
  test("samples every page beyond 2000 tracks and can restrict Chart Clash to Audius", async () => {
    const fixture = await memoryCatalog();
    try {
      const songs = Array.from({ length: 2011 }, (_, index) => song(`audius-${String(index).padStart(5, "0")}`, { genre: "Pop" }));
      for (let offset = 0; offset < songs.length; offset += 400) await fixture.db.insert(tracks).values(songs.slice(offset, offset + 400));
      await fixture.db.insert(tracks).values(song("deezer-999", { genre: "Pop", playCount: 0, popularityScore: 900000 }));
      await organizeCatalog(fixture.catalogDb);
      const all = await selectPool("global-mix", 0, { db: fixture.catalogDb, audiusOnly: true });
      expect(all).toHaveLength(2011);
      expect(new Set(all.map(track => track.id)).size).toBe(2011);
      expect(all.some(track => track.id === "audius-02010")).toBe(true);
      expect(all.some(track => track.id.startsWith("deezer-"))).toBe(false);
    } finally { await fixture.client.close(); }
  });

  test("a public configuration without approval hides previews from public catalog counts and search", async () => {
    const fixture = await memoryCatalog();
    const before = { APP_URL: process.env.APP_URL, DEEZER_PRIVATE_PREVIEWS: process.env.DEEZER_PRIVATE_PREVIEWS };
    try {
      process.env.DEEZER_PRIVATE_PREVIEWS = "true"; process.env.APP_URL = "https://music.example.com";
      await fixture.db.insert(tracks).values([song("audius-allowed", { genre: "Pop" }), song("deezer-123", { genre: "Pop" })]);
      const packs = await organizeCatalog(fixture.catalogDb);
      expect(packs.find(pack => pack.id === "global-mix")?.count).toBe(1);
      expect(packs.find(pack => pack.id === "hits")?.count).toBe(0);
      expect(ids(await searchCatalog({ packId: "global-mix" }, fixture.catalogDb))).toEqual(["audius-allowed"]);
    } finally {
      if (before.APP_URL === undefined) delete process.env.APP_URL; else process.env.APP_URL = before.APP_URL;
      if (before.DEEZER_PRIVATE_PREVIEWS === undefined) delete process.env.DEEZER_PRIVATE_PREVIEWS; else process.env.DEEZER_PRIVATE_PREVIEWS = before.DEEZER_PRIVATE_PREVIEWS;
      await fixture.client.close();
    }
  });

  test("approved public previews appear in hit and genre packs while Chart Clash remains Audius-only", async () => {
    const fixture = await memoryCatalog();
    const keys = ["APP_URL", "DEEZER_PRIVATE_PREVIEWS", "DEEZER_PUBLIC_PREVIEWS_APPROVED", "DEEZER_PUBLIC_PREVIEWS_ORIGIN"] as const;
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, { APP_URL: "https://music.example.com", DEEZER_PRIVATE_PREVIEWS: "false", DEEZER_PUBLIC_PREVIEWS_APPROVED: "true", DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com" });
      await fixture.db.insert(tracks).values([song("audius-allowed", { genre: "Pop" }), song("deezer-123", { artist: "Kanye West", genre: "Hip-Hop/Rap", playCount: 0, popularityScore: 900000 })]);
      await fixture.db.insert(packs).values({ id: "featured-hits", slug: "featured-hits", name: "100 hitmakers", description: "A curated selection of major pop, rap, rock, electronic and Latin artists. Official previews for private local listening.", coverArt: "global" });
      const summaries = await organizeCatalog(fixture.catalogDb);
      expect(summaries.find(pack => pack.id === "global-mix")).toMatchObject({ count: 2, chartCount: 1, previewCount: 1 });
      expect(summaries.find(pack => pack.id === "featured-hits")).toMatchObject({ count: 1, previewCount: 1 });
      expect(summaries.find(pack => pack.id === "featured-hits")?.description).not.toContain("private local");
      expect(summaries.find(pack => pack.id === "hip-hop")?.count).toBe(1);
      expect(ids(await searchCatalog({ query: "Kanye" }, fixture.catalogDb))).toEqual(["deezer-123"]);
      expect(ids(await selectPool("global-mix", 0, { db: fixture.catalogDb, audiusOnly: true }))).toEqual(["audius-allowed"]);
      process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED = "false";
      expect(await searchCatalog({ query: "Kanye" }, fixture.catalogDb)).toEqual([]);
      expect((await listPacks(fixture.catalogDb)).find(pack => pack.id === "featured-hits")?.count).toBe(0);
    } finally {
      for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
      await fixture.client.close();
    }
  });
});

describe("safe catalog organization", () => {
  test("identifies default collections as automatic and custom packs as manual", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(packs).values({ id: "custom", slug: "custom", name: "Custom", description: "Chosen songs", coverArt: "global" });
      const summaries = await listPacks(catalogDb);
      for (const definition of DEFAULT_PACKS) expect(summaries.find(pack => pack.id === definition.id)?.membership).toBe("automatic");
      expect(summaries.find(pack => pack.id === "custom")?.membership).toBe("manual");
    } finally { await client.close(); }
  }, 30000);

  test("imports a batch into all matching derived collections and preserves custom membership", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(packs).values({ id: "custom", slug: "custom", name: "Custom", description: "Chosen songs", coverArt: "global" });
      await importTracks([
        song("rock-2015", { genre: "Rock", releaseYear: 2015 }),
        song("pop-2025", { genre: "Pop", releaseYear: 2025 }),
      ], "custom", catalogDb);
      expect(ids(await searchCatalog({ packId: "rock" }, catalogDb))).toEqual(["rock-2015"]);
      expect(ids(await searchCatalog({ packId: "2010s" }, catalogDb))).toEqual(["rock-2015"]);
      expect(ids(await searchCatalog({ packId: "pop" }, catalogDb))).toEqual(["pop-2025"]);
      expect(ids(await searchCatalog({ packId: "2020s" }, catalogDb))).toEqual(["pop-2025"]);
      expect(ids(await searchCatalog({ packId: "custom" }, catalogDb))).toEqual(["pop-2025", "rock-2015"]);
      expect(await db.select().from(packTracks).where(eq(packTracks.packId, "global-mix"))).toHaveLength(2);
    } finally { await client.close(); }
  }, 30000);

  test("rejects imports directed at metadata collections before inserting mislabeled tracks", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await expect(importTracks([song("rock", { genre: "Rock" })], "pop", catalogDb)).rejects.toThrow("global mix or a custom pack");
      expect(await db.select().from(tracks)).toHaveLength(0);
    } finally { await client.close(); }
  }, 30000);

  test("prevents manual membership overrides while keeping custom packs editable", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(packs).values({ id: "custom", slug: "custom", name: "Custom", description: "Chosen songs", coverArt: "global" });
      await db.insert(tracks).values(song("rock", { genre: "Rock" }));
      await organizeCatalog(catalogDb);
      await expect(attachToPack("pop", ["rock"], catalogDb)).rejects.toThrow("track metadata");
      await expect(removePackTrack("rock", "rock", catalogDb)).rejects.toThrow("track metadata");
      await expect(removePackTrack("global-mix", "rock", catalogDb)).rejects.toThrow("every imported song");
      expect(await attachToPack("custom", ["rock"], catalogDb)).toBe(1);
      expect(ids(await searchCatalog({ packId: "custom" }, catalogDb))).toEqual(["rock"]);
      await removePackTrack("custom", "rock", catalogDb);
      expect(await searchCatalog({ packId: "custom" }, catalogDb)).toHaveLength(0);
    } finally { await client.close(); }
  }, 30000);

  test("rebuilds only automatic memberships and retains tracks, admin packs, and metadata edits", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(tracks).values([
        song("pop", { genre: "Pop", releaseYear: 2015 }),
        song("rock", { genre: "Rock", releaseYear: 2023 }),
        song("alternative", { genre: "Alternative", releaseYear: 2018 }),
        song("unavailable", { genre: "Pop", available: false }),
      ]);
      await db.insert(packs).values({ id: "admin-pack", slug: "admin-pack", name: "My custom pack", description: "Hand-picked songs", genre: null, coverArt: "global" });
      await db.update(packs).set({ name: "My edited indie name", description: "My edited description" }).where(eq(packs.id, "indie"));
      await db.insert(packTracks).values([
        { packId: "global-mix", trackId: "unavailable" },
        { packId: "admin-pack", trackId: "pop" },
        { packId: "indie", trackId: "pop" },
        { packId: "indie", trackId: "rock" },
      ]);
      await organizeCatalog(catalogDb);
      await organizeCatalog(catalogDb);

      const membership = await db.select().from(packTracks);
      expect(membership.filter(row => row.packId === "indie").map(row => row.trackId)).toEqual(["alternative"]);
      expect(membership.filter(row => row.packId === "pop").map(row => row.trackId)).toEqual(["pop"]);
      expect(membership.filter(row => row.packId === "rock").map(row => row.trackId)).toEqual(["rock"]);
      expect(membership.filter(row => row.packId === "2010s").map(row => row.trackId).sort()).toEqual(["alternative", "pop"]);
      expect(membership.filter(row => row.packId === "admin-pack")).toEqual([{ packId: "admin-pack", trackId: "pop" }]);
      expect(membership).toContainEqual({ packId: "global-mix", trackId: "unavailable" });
      expect(await db.select().from(tracks)).toHaveLength(4);
      expect((await db.select().from(packs).where(eq(packs.id, "indie")))[0].name).toBe("My edited indie name");
      expect((await db.select().from(packs).where(eq(packs.id, "indie")))[0].description).toBe("My edited description");
      expect(await db.select().from(packs)).toHaveLength(DEFAULT_PACKS.length + 1);
    } finally { await client.close(); }
  }, 30000);

  test("reimports update provider popularity while preserving admin track edits", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      const edited = song("edited", {
        title: "Corrected title", artist: "Corrected artist", genre: "Rock", releaseYear: 2018,
        language: "English", clipStartSec: 25, available: false,
      });
      await db.insert(tracks).values(edited);
      await importTracks([song("edited", { title: "Provider title", genre: "Pop", releaseYear: 2026, playCount: 5500 })], "global-mix", catalogDb);
      const stored = (await db.select().from(tracks))[0];
      expect(stored.title).toBe(edited.title);
      expect(stored.artist).toBe(edited.artist);
      expect(stored.genre).toBe(edited.genre);
      expect(stored.releaseYear).toBe(edited.releaseYear);
      expect(stored.language).toBe(edited.language);
      expect(stored.clipStartSec).toBe(edited.clipStartSec);
      expect(stored.available).toBe(false);
      expect(stored.playCount).toBe(5500);
    } finally { await client.close(); }
  }, 30000);

  test("rolls back membership and seed-definition changes if rebuilding fails", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(tracks).values(song("pop", { genre: "Pop" }));
      await db.insert(packTracks).values({ packId: "indie", trackId: "pop" });
      await client.exec("ALTER TABLE pack_tracks ADD CONSTRAINT reject_pop CHECK (pack_id <> 'pop')");
      await expect(organizeCatalog(catalogDb)).rejects.toThrow();
      expect(await db.select().from(packTracks)).toEqual([{ packId: "indie", trackId: "pop" }]);
      expect(await db.select().from(packs)).toHaveLength(4);
    } finally { await client.close(); }
  }, 30000);

  test("keeps public discovery alphabetical and ranks plays only when explicitly requested", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(tracks).values([
        song("top", { title: "Z track", genre: "Pop", releaseYear: 2015, playCount: 1000 }),
        song("a", { title: "C track", genre: "Rock", releaseYear: 2011, playCount: 200 }),
        song("z", { title: "A track", genre: "Jazz", releaseYear: 2015, playCount: 200 }),
      ]);
      await organizeCatalog(catalogDb);
      expect(ids(await searchCatalog({ packId: "2010s" }, catalogDb))).toEqual(["z", "a", "top"]);
      expect(ids(await searchCatalog({ packId: "popular" }, catalogDb))).toEqual(["z", "a", "top"]);
      expect(ids(await searchCatalog({ packId: "2010s", sort: "popularity" }, catalogDb))).toEqual(["top", "a", "z"]);
    } finally { await client.close(); }
  }, 30000);
});

describe("catalog refresh collection updates", () => {
  test("refreshes the top 200 when play counts change and removes newly unavailable tracks", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    const input = Array.from({ length: 205 }, (_, index) => song(String(index).padStart(3, "0"), { genre: "Pop", releaseYear: 2015, playCount: index }));
    try {
      await db.insert(tracks).values(input);
      await organizeCatalog(catalogDb);
      expect(ids(await searchCatalog({ packId: "popular", limit: 2000 }, catalogDb))).not.toContain("000");
      expect(await refreshCatalog(205, 0, { db: catalogDb, getTrack: async id => id === "204" ? null : song(id, { playCount: id === "000" ? 10_000 : Number(id) }) })).toEqual({ checked: 205, nextOffset: 205 });
      const popular = ids(await searchCatalog({ packId: "popular", sort: "popularity", limit: 2000 }, catalogDb));
      expect(popular).toHaveLength(200);
      expect(popular[0]).toBe("000");
      expect(popular).not.toContain("204");
      const memberships = await db.select().from(packTracks).where(eq(packTracks.trackId, "204"));
      expect(memberships).toEqual([{ packId: "global-mix", trackId: "204" }]);
    } finally { await client.close(); }
  }, 30000);

  test("organizes completed refresh writes even if a later provider request fails", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    const getTrack = async (id: string) => {
      if (id === "b") throw new ProviderError();
      return null;
    };
    try {
      await db.insert(tracks).values([song("a", { genre: "Rock", releaseYear: 2015 }), song("b", { genre: "Pop", releaseYear: 2025 })]);
      await organizeCatalog(catalogDb);
      await expect(refreshCatalog(2, 0, { db: catalogDb, getTrack })).rejects.toBeInstanceOf(ProviderError);
      expect(await db.select().from(packTracks).where(eq(packTracks.trackId, "a"))).toEqual([{ packId: "global-mix", trackId: "a" }]);
      expect(ids(await searchCatalog({ packId: "pop" }, catalogDb))).toEqual(["b"]);
    } finally { await client.close(); }
  }, 30000);
});

describe("balanced catalog imports", () => {
  test("fills the playable target without re-enabling previously disabled songs", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      const active = Array.from({ length: 8 }, (_, index) => song(`existing-${index}`, { genre: "Electronic", releaseYear: 2025 }));
      const disabled = [song("disabled-pop", { genre: "Pop", releaseYear: 2015, available: false }), song("disabled-rock", { genre: "Rock", available: false })];
      await db.insert(tracks).values([...active, ...disabled]);
      const progress: number[] = [];
      const result = await seedCatalog(10, count => progress.push(count), {
        db: catalogDb,
        searchGenre: async genre => genre === "Pop" ? [song("disabled-pop", { genre: "Pop", available: true }), song("fresh-pop-a", { genre: "Pop" }), song("fresh-pop-b", { genre: "Pop" })] : [],
        trending: async () => [],
        search: async () => [],
      });
      expect(result).toBe(10);
      expect(progress).toEqual([10]);
      expect((await db.select().from(tracks)).length).toBe(12);
      expect((await db.select().from(tracks).where(eq(tracks.id, "disabled-pop")))[0]?.available).toBe(false);
      expect((await db.select().from(tracks).where(eq(tracks.id, "disabled-rock")))[0]?.available).toBe(false);
    } finally { await client.close(); }
  });
  test("balances sparse genres before global trending even when 1000 tracks already exist", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(tracks).values(Array.from({ length: 1000 }, (_, index) => song(`stored-${index}`, { genre: "Electronic", releaseYear: 2025 })));
      const requestedGenres: Array<string | undefined> = [];
      const result = await seedCatalog(1040, undefined, {
        db: catalogDb,
        trending: async (offset = 0, limit = 100, genre) => {
          void limit;
          requestedGenres.push(genre);
          if (offset > 0) return [];
          return Array.from({ length: genre ? 20 : 40 }, (_, index) => song(`${genre ?? "global"}-${index}`, { genre: genre ?? "Electronic", releaseYear: 2024 }));
        },
        searchGenre: async () => [],
        search: async () => [],
      });
      const stored = await db.select().from(tracks);
      expect(result).toBe(1040);
      expect(stored).toHaveLength(1040);
      const counts = countGenrePacks(stored);
      for (const count of Object.values(counts)) expect(count).toBeGreaterThanOrEqual(10);
      expect(requestedGenres[0]).toBe("Pop");
    } finally { await client.close(); }
  }, 30000);

  test("prioritizes actual 2010s releases and never assigns missing years from year-text searches", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(tracks).values(Array.from({ length: 1000 }, (_, index) => song(`stored-${index}`, { genre: "Electronic", releaseYear: 2025 })));
      const result = await seedCatalog(1020, undefined, {
        db: catalogDb,
        trending: async (offset = 0, limit = 100, genre) => {
          void offset;
          void limit;
          return genre ? [] : Array.from({ length: 20 }, (_, index) => song(`new-global-${index}`, { genre: "Electronic", releaseYear: 2025 }));
        },
        searchGenre: async () => [],
        search: async query => query === "2010" ? [
          song("unknown-year", { title: "My 2010 hit", releaseYear: null }),
          song("recent-remix", { title: "2010 remake", releaseYear: 2025 }),
          ...Array.from({ length: 25 }, (_, index) => song(`old-${index}`, { genre: "Jazz", releaseYear: 2015 })),
        ] : [],
      });
      const stored = await db.select().from(tracks);
      expect(result).toBe(1020);
      expect(selectPackTracks("2010s", stored)).toHaveLength(20);
      expect(stored.some(track => track.id === "unknown-year" || track.id === "recent-remix")).toBe(false);
    } finally { await client.close(); }
  }, 30000);

  test("continues genre-filtered search pagination past already-imported first pages", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      const input = Array.from({ length: 1000 }, (_, index) => song(`stored-${index}`, {
        genre: index < 5 ? "Pop" : index < 105 ? "Rock" : index < 205 ? "Alternative" : index < 305 ? "Hip-Hop/Rap" : "Electronic",
        releaseYear: 2025,
      }));
      await db.insert(tracks).values(input);
      const offsets: number[] = [];
      const result = await seedCatalog(1015, undefined, {
        db: catalogDb,
        trending: async () => [],
        search: async () => [],
        searchGenre: async (genre, offset = 0) => {
          if (genre !== "Pop") return [];
          offsets.push(offset);
          return offset === 0 ? input.slice(0, 5) : Array.from({ length: 15 }, (_, index) => song(`new-pop-${index}`, { genre: "Pop", releaseYear: 2025 }));
        },
      });
      expect(result).toBe(1015);
      expect(offsets).toEqual([0, 100]);
      expect(countGenrePacks(await db.select().from(tracks)).pop).toBe(20);
    } finally { await client.close(); }
  }, 30000);

  test("bounds repeated provider failures and still organizes the existing catalog", async () => {
    const { client, db, catalogDb } = await memoryCatalog();
    try {
      await db.insert(tracks).values(song("existing", { genre: "Electronic" }));
      let attempts = 0;
      const unavailable = async () => { attempts++; throw new ProviderError(); };
      await expect(seedCatalog(10, undefined, {
        db: catalogDb, trending: unavailable, search: unavailable, searchGenre: unavailable,
      })).rejects.toBeInstanceOf(ProviderError);
      expect(attempts).toBe(6);
      expect(await db.select().from(packs)).toHaveLength(DEFAULT_PACKS.length);
      expect(await db.select().from(packTracks).where(eq(packTracks.packId, "electronic"))).toEqual([{ packId: "electronic", trackId: "existing" }]);
    } finally { await client.close(); }
  }, 30000);
});
