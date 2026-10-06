import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, notLike, or, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { getDatabase } from "./db";
import { packs, packTracks, tracks } from "./schema";
import { audiusGet, getAudiusTrack, normalizeAudiusTrack, ProviderError, searchAudius, trendingAudius } from "./audius";
import { AUTO_PACK_IDS, DEFAULT_PACKS, GENRE_IMPORT_TARGETS, countGenrePacks, selectPackTracks } from "./catalog-packs";
import type { CatalogFilters, PackSummary, Track } from "../shared/contracts";
import { deezerPreviewsEnabled, getDeezerTrack } from "./deezer";
export { DEFAULT_PACKS } from "./catalog-packs";

type CatalogDatabase = ReturnType<typeof getDatabase>;
export class CatalogError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
const isDerivedPack = (packId: string) => AUTO_PACK_IDS.some(id => id === packId);
export function assertImportTarget(packId: string) {
  if (isDerivedPack(packId)) throw new CatalogError("AUTOMATIC_COLLECTION", "This collection follows track metadata and current play counts. Import into the global mix or a custom pack; edit the song's genre/release year to change its collections.");
}
function assertManualMembership(packId: string) {
  if (packId === "global-mix") throw new CatalogError("AUTOMATIC_COLLECTION", "This collection includes every imported song. Change the song's availability or use a custom pack.");
  if (isDerivedPack(packId)) throw new CatalogError("AUTOMATIC_COLLECTION", "This collection follows track metadata and current play counts. Edit the song's genre/release year or use a custom pack.");
}
async function ensureDefaultPacks(db: Pick<CatalogDatabase, "insert">) {
  await db.insert(packs).values(DEFAULT_PACKS.map(pack => ({
    id: pack.id, slug: pack.slug, name: pack.name, description: pack.description,
    genre: pack.genre, coverArt: pack.coverArt,
  }))).onConflictDoNothing();
}

const legacyPreviewDescriptions: Record<string, string> = {
  hits: "Original recordings and official collaborations from well-known artists. Official Deezer previews for private, noncommercial local listening.",
  "hits-2010s": "Songs by well-known artists with provider release dates from 2010 to 2019. Official Deezer previews for private, noncommercial local listening.",
  "featured-hits": "A curated selection of major pop, rap, rock, electronic and Latin artists. Official previews for private local listening.",
};
function displayPackDescription(item: { id: string; description: string; previewCount: number }): string {
  // Adapt only known legacy defaults; never overwrite an admin's description.
  const description = item.description === legacyPreviewDescriptions[item.id]
    ? DEFAULT_PACKS.find(pack => pack.id === item.id)?.description || item.description : item.description;
  if (item.previewCount && item.id === "global-mix" && description === "A little of everything from Audius. Find your next favorite.") return "Independent Audius songs and official previews from familiar artists. Find your next favorite.";
  if (item.previewCount && ["2010s", "2020s"].includes(item.id) && description.startsWith("Audius tracks with release years")) return description.replace("Audius tracks", "Songs").replace("Popularity reflects current Audius play counts.", "Reissues follow their edition’s release date.");
  return description;
}

export async function listPacks(db: CatalogDatabase = getDatabase()): Promise<PackSummary[]> {
  await ensureDefaultPacks(db);
  const data = await db.select({ ...getTableColumns(packs), count: sql<number>`count(${tracks.id})::integer`, chartCount: sql<number>`count(${tracks.id}) filter (where ${tracks.id} not like 'deezer-%')::integer`, previewCount: sql<number>`count(${tracks.id}) filter (where ${tracks.id} like 'deezer-%')::integer` }).from(packs)
    .leftJoin(packTracks, eq(packTracks.packId, packs.id)).leftJoin(tracks, and(eq(tracks.id, packTracks.trackId), eq(tracks.available, true), deezerPreviewsEnabled() ? undefined : notLike(tracks.id, "deezer-%")))
    .groupBy(packs.id).orderBy(asc(packs.id));
  return data.map(item => ({ ...item,
    description: displayPackDescription(item),
    genre: item.genre || null, coverArt: item.coverArt as PackSummary["coverArt"], membership: item.id === "global-mix" || isDerivedPack(item.id) ? "automatic" : "manual" }));
}

export async function organizeCatalog(db: CatalogDatabase = getDatabase()): Promise<PackSummary[]> {
  await db.transaction(async tx => {
    await ensureDefaultPacks(tx);
    // Serialize organizers while all membership changes remain in one transaction.
    const managed = await tx.select({ id: packs.id }).from(packs).where(inArray(packs.id, AUTO_PACK_IDS)).orderBy(asc(packs.id)).for("update");
    const all = await tx.select().from(tracks);
    if (managed.length) await tx.delete(packTracks).where(inArray(packTracks.packId, managed.map(pack => pack.id)));
    const membership = [
      ...all.map(track => ({ packId: "global-mix", trackId: track.id })),
      ...managed.flatMap(pack => selectPackTracks(pack.id, all).map(track => ({ packId: pack.id, trackId: track.id }))),
    ];
    for (let index = 0; index < membership.length; index += 1000) {
      await tx.insert(packTracks).values(membership.slice(index, index + 1000)).onConflictDoNothing();
    }
  });
  return listPacks(db);
}
export async function catalogFilters(): Promise<CatalogFilters> {
  const rows = await getDatabase().select({ genre: tracks.genre, year: tracks.releaseYear, language: tracks.language }).from(tracks).where(and(eq(tracks.available, true), deezerPreviewsEnabled() ? undefined : notLike(tracks.id, "deezer-%")));
  return { genres: [...new Set(rows.map(row => row.genre).filter((value): value is string => !!value))].sort(), decades: [...new Set(rows.map(row => row.year ? Math.floor(row.year / 10) * 10 : null).filter((value): value is number => value !== null))].sort((a, b) => b - a), languages: [...new Set(rows.map(row => row.language).filter((value): value is string => !!value))].sort() };
}
export interface SearchFilters { query?: string; packId?: string; genre?: string; decade?: number; language?: string; limit?: number; offset?: number; includeUnavailable?: boolean; audiusOnly?: boolean; sort?: "popularity" | "title" }
export async function searchCatalog(options: SearchFilters = {}, db: CatalogDatabase = getDatabase()): Promise<Track[]> {
  const conditions = [];
  if (!options.includeUnavailable) conditions.push(eq(tracks.available, true));
  if (options.audiusOnly || (!options.includeUnavailable && !deezerPreviewsEnabled())) conditions.push(notLike(tracks.id, "deezer-%"));
  if (options.query) conditions.push(or(ilike(tracks.title, `%${options.query}%`), ilike(tracks.artist, `%${options.query}%`)));
  if (options.genre) conditions.push(eq(tracks.genre, options.genre));
  if (options.language) conditions.push(eq(tracks.language, options.language));
  if (options.decade) conditions.push(and(gte(tracks.releaseYear, options.decade), lt(tracks.releaseYear, options.decade + 10)));
  const base = options.packId ? db.select({ track: tracks }).from(tracks).innerJoin(packTracks, and(eq(packTracks.trackId, tracks.id), eq(packTracks.packId, options.packId))) : db.select({ track: tracks }).from(tracks);
  const order = options.sort === "popularity" ? [desc(sql`greatest(${tracks.popularityScore}, least(${tracks.playCount}, 1000000))`), asc(tracks.id)] : [asc(tracks.title), asc(tracks.artist), asc(tracks.id)];
  const rows = await base.where(and(...conditions)).orderBy(...order).limit(Math.min(2000, options.limit ?? 20)).offset(Math.max(0, options.offset ?? 0));
  return rows.map(row => row.track);
}
export async function catalogTrack(id: string, db: CatalogDatabase = getDatabase()) { return (await db.select().from(tracks).where(eq(tracks.id, id)).limit(1))[0] || null; }
export async function importTracks(input: Track[], packId = "global-mix", db: CatalogDatabase = getDatabase(), options: { deferOrganization?: boolean } = {}) {
  assertImportTarget(packId);
  await ensureDefaultPacks(db);
  const pack = await db.select().from(packs).where(eq(packs.id, packId)).limit(1);
  if (!pack.length) throw new CatalogError("NOT_FOUND", "That music pack does not exist.", 404);
  await db.transaction(async tx => {
    for (const track of input) {
      await tx.insert(tracks).values({ ...track, duration: Math.floor(track.duration), clipStartSec: Math.floor(track.clipStartSec) }).onConflictDoUpdate({ target: tracks.id, set: { playCount: track.playCount, popularityScore: track.popularityScore ?? 0, artworkUrl: track.artworkUrl, license: track.license, sourceUrl: track.sourceUrl, updatedAt: new Date() } });
      await tx.insert(packTracks).values([{ packId: "global-mix", trackId: track.id }, ...(packId !== "global-mix" ? [{ packId, trackId: track.id }] : [])]).onConflictDoNothing();
    }
  });
  if (!options.deferOrganization) await organizeCatalog(db);
  return { imported: input.length, total: (await listPacks(db)).find(pack => pack.id === packId)?.count || 0 };
}
export async function updateCatalogTrack(id: string, input: Partial<Pick<Track, "title" | "artist" | "clipStartSec" | "genre" | "releaseYear" | "language" | "available">>, db: CatalogDatabase = getDatabase()) {
  if (Object.keys(input).length) await db.update(tracks).set({ ...input, updatedAt: new Date() }).where(eq(tracks.id, id));
  if (input.genre !== undefined || input.releaseYear !== undefined || input.available !== undefined) await organizeCatalog(db);
  return catalogTrack(id, db);
}
export async function selectPool(packId: string, difficulty = 0, options: { audiusOnly?: boolean; db?: CatalogDatabase } = {}): Promise<Track[]> {
  let songs: Track[] = [];
  for (let offset = 0; ; offset += 2000) {
    const page = await searchCatalog({ packId, limit: 2000, offset, sort: "popularity", audiusOnly: options.audiusOnly }, options.db);
    songs.push(...page);
    if (page.length < 2000) break;
  }
  if (difficulty > 0) {
    const start = Math.floor(songs.length * (difficulty - 1) / 5);
    const end = difficulty === 5 ? songs.length : Math.floor(songs.length * difficulty / 5);
    songs = songs.slice(start, end);
  }
  for (let index = songs.length - 1; index > 0; index--) { const other = randomInt(index + 1); [songs[index], songs[other]] = [songs[other], songs[index]]; }
  return songs;
}
async function searchGenreAudius(genre: string, offset = 0, limit = 100): Promise<Track[]> {
  const data = await audiusGet("tracks/search", { genre, sort_method: "popular", offset, limit: Math.min(100, limit) });
  return Array.isArray(data) ? data.map(normalizeAudiusTrack).filter((track): track is Track => !!track) : [];
}
export interface CatalogSeedOptions {
  db?: CatalogDatabase;
  trending?: typeof trendingAudius;
  search?: typeof searchAudius;
  searchGenre?: typeof searchGenreAudius;
  onStatus?: (message: string) => void;
}
export async function seedCatalog(target = 1500, onProgress?: (count: number) => void, options: CatalogSeedOptions = {}) {
  if (!Number.isFinite(target)) throw new RangeError("The catalog target must be a finite number.");
  target = Math.min(2000, Math.max(10, Math.floor(target)));
  const db = options.db ?? getDatabase();
  const getTrending = options.trending ?? trendingAudius;
  const getSearch = options.search ?? searchAudius;
  const getGenreSearch = options.searchGenre ?? searchGenreAudius;
  const catalog = new Map<string, Track>((await db.select().from(tracks).where(notLike(tracks.id, "deezer-%"))).map(track => [track.id, track]));
  let playableCount = [...catalog.values()].filter(track => track.available).length;
  const candidateCache = new Map<string, Track[]>();
  let failedPages = 0;
  const readPage = async (request: () => Promise<Track[]>, label: string): Promise<Track[]> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await request();
        failedPages = 0;
        return result;
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        if (attempt === 0) {
          options.onStatus?.(`${label}: retrying the music service once.`);
          await new Promise(resolve => setTimeout(resolve, 250));
        } else {
          failedPages++;
          options.onStatus?.(`${label}: unavailable after two attempts.`);
          if (failedPages >= 3) throw error;
        }
      }
    }
    return [];
  };
  const addFresh = async (input: Track[], requested = target - playableCount) => {
    const fresh = selectPackTracks("global-mix", input).filter(track => !catalog.has(track.id))
      .slice(0, Math.max(0, Math.min(requested, target - playableCount)));
    if (!fresh.length) return;
    await importTracks(fresh, "global-mix", db, { deferOrganization: true });
    fresh.forEach(track => catalog.set(track.id, track));
    playableCount += fresh.length;
    onProgress?.(playableCount);
  };
  const genreCandidates = async (definition: typeof GENRE_IMPORT_TARGETS[number]) => {
    const cached = candidateCache.get(definition.packId);
    if (cached) return cached;
    let candidates: Track[] = [];
    const needed = Math.min(100 - countGenrePacks([...catalog.values()])[definition.packId], target - playableCount);
    for (let offset = 0; offset < 500 && candidates.length < needed; offset += 100) {
      const page = await readPage(() => getGenreSearch(definition.genre, offset, 100), `${definition.genre} filtered search`);
      candidates = selectPackTracks(definition.packId, [...candidates, ...page]).filter(track => !catalog.has(track.id));
      if (!page.length) break;
    }
    for (let offset = 0; offset < 300 && candidates.length < needed; offset += 100) {
      const page = await readPage(() => getTrending(offset, 100, definition.genre), `${definition.genre} trending`);
      candidates = selectPackTracks(definition.packId, [...candidates, ...page]).filter(track => !catalog.has(track.id));
      // A duplicate first page is common for an existing catalog; continue to the next offset.
      if (!page.length) break;
    }
    if (candidates.length < needed) {
      const page = await readPage(() => getSearch(definition.query, 100), `${definition.genre} search`);
      candidates = selectPackTracks(definition.packId, [...candidates, ...page]).filter(track => !catalog.has(track.id));
    }
    candidateCache.set(definition.packId, candidates);
    return candidates;
  };
  const balanceGenres = async (minimum: number) => {
    for (const definition of GENRE_IMPORT_TARGETS) {
      if (playableCount >= target) break;
      const needed = minimum - countGenrePacks([...catalog.values()])[definition.packId];
      if (needed > 0) await addFresh(await genreCandidates(definition), needed);
    }
  };
  let organized: PackSummary[] = [];
  try {
    options.onStatus?.("Balancing Pop, Rock, Alternative, and Hip-Hop/Rap collections.");
    await balanceGenres(10);
    options.onStatus?.("Finding tracks with real release years from 2010 to 2019.");
    for (let year = 2010; year < 2020 && playableCount < target; year++) {
      const needed = 50 - selectPackTracks("2010s", [...catalog.values()]).length;
      if (needed <= 0) break;
      const page = await readPage(() => getSearch(String(year), 100), `${year} search`);
      await addFresh(selectPackTracks("2010s", page), needed);
    }
    await balanceGenres(100);
    options.onStatus?.("Filling the remaining catalog budget from public Audius music.");
    const genres = [undefined, "Electronic", "Hip-Hop/Rap", "Alternative", "Pop", "Rock", "House", "Techno", "Ambient", "Trap", "R&B/Soul", "Jazz", "Latin", "Funk", "Folk", "Acoustic"];
    for (const genre of genres) {
      if (playableCount >= target) break;
      for (let offset = 0; offset < 300 && playableCount < target; offset += 100) {
        const page = await readPage(() => getTrending(offset, 100, genre), `${genre ?? "All genres"} trending`);
        await addFresh(page);
        if (!page.length) break;
      }
    }
    const queries = ["indie", "pop", "rock", "hip hop", "electronic", "house", "ambient", "soul", "jazz", "latin", "funk", "dance", "piano", "guitar", "love", "night"];
    for (const query of queries) {
      if (playableCount >= target) break;
      await addFresh(await readPage(() => getSearch(query, 100), `${query} search`));
    }
  } finally {
    organized = await organizeCatalog(db);
  }
  return organized.find(pack => pack.id === "global-mix")?.chartCount ?? 0;
}
export async function refreshCatalog(limit = 50, offset = 0, options: { db?: CatalogDatabase; getTrack?: typeof getAudiusTrack } = {}) {
  const db = options.db ?? getDatabase();
  const getTrack = options.getTrack ?? getAudiusTrack;
  const batch = await db.select().from(tracks).orderBy(asc(tracks.id)).limit(limit).offset(offset);
  let checked = 0;
  try {
    for (const track of batch) {
      if (track.id.startsWith("deezer-") && !deezerPreviewsEnabled() && !options.getTrack) continue;
      const current = await (options.getTrack ? getTrack(track.providerId) : track.id.startsWith("deezer-") ? getDeezerTrack(track.providerId) : getTrack(track.providerId));
      await db.update(tracks).set(current ? { playCount: current.playCount, popularityScore: current.popularityScore ?? 0, license: current.license, updatedAt: new Date() } : { available: false, updatedAt: new Date() }).where(eq(tracks.id, track.id));
      checked++;
    }
  } finally {
    await organizeCatalog(db);
  }
  return { checked, nextOffset: batch.length === limit ? offset + limit : null };
}
export async function removePackTrack(packId: string, trackId: string, db: CatalogDatabase = getDatabase()) {
  assertManualMembership(packId);
  return db.delete(packTracks).where(and(eq(packTracks.packId, packId), eq(packTracks.trackId, trackId)));
}
export async function attachToPack(packId: string, ids: string[], db: CatalogDatabase = getDatabase()) {
  assertManualMembership(packId);
  if (!ids.length) return 0;
  const existing = await db.select({ id: tracks.id }).from(tracks).where(inArray(tracks.id, ids));
  await db.insert(packTracks).values(existing.map(track => ({ packId, trackId: track.id }))).onConflictDoNothing();
  return existing.length;
}
