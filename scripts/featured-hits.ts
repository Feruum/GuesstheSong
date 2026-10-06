import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { FEATURED_ARTISTS, DEFERRED_FEATURED_ARTISTS, SPOTIFY_ARTIST_SOURCE, artistIdentity, type FeaturedArtist } from "../src/shared/featured-artists";
import { completeFeaturedManifest, resolveFeaturedArtist, selectFeaturedSongs, type FeaturedSong } from "./music-sources/featured-hits";
import { deezerGet, getDeezerTrack, privatePreviewsEnabled } from "../src/server/deezer";
import { importTracks, organizeCatalog } from "../src/server/catalog";
import { getPool } from "../src/server/db";

const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false, options: {
  import: { type: "boolean", default: false }, "per-artist": { type: "string", default: "5" },
  output: { type: "string", default: "data/featured-hitmakers.json" }, help: { type: "boolean", short: "h", default: false },
} });
const perArtist = Number(values["per-artist"]);
const output = resolve(values.output);
if (!Number.isInteger(perArtist) || perArtist < 5 || perArtist > 20) throw new Error("Choose 5–20 songs per artist.");
if (![resolve("data"), resolve(".data")].some(directory => output.startsWith(`${directory}/`) || output.startsWith(`${directory}\\`)) || !output.endsWith(".json")) throw new Error("Output must be a JSON file inside data/ or .data/.");
const escape = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\[\]`*<>|]/g, "\\$&");
type ArtistResult = { name: string; genre: string; artistId: number | null; songs: FeaturedSong[]; error?: string };

async function resolveArtist(target: FeaturedArtist) {
  for (const name of [target.name, ...target.aliases ?? []]) {
    const params = { q: name, limit: 25 };
    const file = resolve(".data/deezer-metadata", `search-artist-${Buffer.from(JSON.stringify(params)).toString("base64url")}.json`);
    try {
      const cached = JSON.parse(await readFile(file, "utf8")) as { data?: { data?: unknown } };
      const candidate = resolveFeaturedArtist(target, cached.data?.data);
      if (candidate) return candidate;
    } catch { /* Cached identity lookup is optional; top songs are always fetched fresh. */ }
    const data = z.object({ data: z.array(z.unknown()) }).parse(await deezerGet("search/artist", params));
    const candidate = resolveFeaturedArtist(target, data.data);
    if (candidate) return candidate;
  }
  throw new Error("No exact canonical artist with an established audience was found.");
}

async function prepareArtist(target: FeaturedArtist): Promise<ArtistResult> {
  try {
    const artist = await resolveArtist(target);
    const response = z.object({ data: z.array(z.unknown()) }).parse(await deezerGet(`artist/${artist.id}/top`, { limit: 50 }));
    const songs = selectFeaturedSongs(response.data, artist.id, perArtist);
    return { name: target.name, genre: target.genre, artistId: artist.id, songs,
      ...(songs.length < perArtist ? { error: `Only ${songs.length}/${perArtist} eligible original previews are available.` } : {}),
    };
  } catch (error) {
    return { name: target.name, genre: target.genre, artistId: null, songs: [], error: error instanceof Error ? error.message : "Provider request failed." };
  }
}

async function prepare() {
  const artists: ArtistResult[] = [];
  for (let offset = 0; offset < FEATURED_ARTISTS.length; offset += 3) {
    const batch = await Promise.all(FEATURED_ARTISTS.slice(offset, offset + 3).map(prepareArtist));
    for (const artist of batch) {
      artists.push(artist);
      console.log(`${artists.length}/100 ${artist.name}: ${artist.songs.length} songs${artist.error ? ` (${artist.error})` : ""}`);
    }
  }
  const deferredArtists: { name: string; artistId: number | null; eligibleSongs: number; reason: string }[] = [];
  for (let offset = 0; offset < DEFERRED_FEATURED_ARTISTS.length; offset += 3) {
    for (const artist of await Promise.all(DEFERRED_FEATURED_ARTISTS.slice(offset, offset + 3).map(prepareArtist))) {
      deferredArtists.push({ name: artist.name, artistId: artist.artistId, eligibleSongs: artist.songs.length,
        reason: artist.error || "Not selected in this editorial collection. Availability has changed; review before selecting this artist.",
      });
    }
  }
  const complete = artists.every(artist => !artist.error);
  const manifest = { generatedAt: new Date().toISOString(), selection: "Editorial international hitmakers; not an official Top 100 chart", artistChartSource: SPOTIFY_ARTIST_SOURCE,
    productionActivated: false, playbackScope: "private-local", songsPerArtist: perArtist, complete, artists, deferredArtists,
  };
  if (complete) completeFeaturedManifest(manifest);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  const document = output.replace(/\.json$/, ".md");
  await writeFile(document, `# 100 hitmakers — полный список\n\nМетаданные проверены ${manifest.generatedAt}. ${artists.length} выбранных артистов, ${artists.reduce((total, artist) => total + artist.songs.length, 0)} записей. Полнота: ${complete ? "100/100" : "есть недоступные записи, см. строки ниже"}. Доступность аудио может меняться независимо от этих метаданных.\n\nЭто подборка для игры, не официальный мировой Top 100. В неё включены доступные исполнители из [списка самых слушаемых артистов Spotify за апрель 2026](${SPOTIFY_ARTIST_SOURCE}) и другие известные исполнители — редакционный выбор с учётом доступных оригиналов. Песни получены из текущих списков Deezer, с точными ID основного исполнителя, без караоке и неофициальных версий. Жанр в этой таблице — редакционная категория артиста; при импорте используются реальные метаданные альбомов.\n\nАудиопревью предназначены для частного локального использования. На публичном Vercel они не активированы. [Условия источника](https://developers.deezer.com/termsofuse).\n\n| № | Артист | Категория | Выбранные песни |\n| --- | --- | --- | --- |\n${artists.map((artist, index) => `| ${index + 1} | ${escape(artist.name)} | ${escape(artist.genre)} | ${artist.songs.map(song => `[${escape(song.title)}](${song.sourceUrl})`).join(" · ")}${artist.error ? ` **${escape(artist.error)}**` : ""} |`).join("\n")}\n\n## Известные артисты, отложенные из-за доступности оригиналов\n\nИх не заменяем каверами и не приписываем им чужие записи. Проверка текущего ответа API:\n\n| Артист | Подходящих записей, максимум ${perArtist} | Статус |\n| --- | --- | --- |\n${deferredArtists.map(artist => `| ${escape(artist.name)} | ${artist.eligibleSongs} | ${escape(artist.reason)} |`).join("\n")}\n`);
  console.log(`Saved ${output} and ${document}. ${complete ? "Complete collection." : "Incomplete; import is blocked."}`);
  if (!complete) process.exitCode = 1;
}

async function importCollection() {
  if (!privatePreviewsEnabled()) throw new Error("Import requires private local preview opt-in and a loopback APP_URL. Public hosting requires a separately authorized source.");
  const manifest = completeFeaturedManifest(JSON.parse(await readFile(output, "utf8")));
  const pool = getPool();
  let imported = 0, reused = 0;
  const failures: { artist: string; trackId: string; reason: string }[] = [];
  try {
    const existing = (await pool.query<{ id: string; artist: string; available: boolean }>("SELECT id,artist,available FROM tracks WHERE id LIKE 'deezer-%'")).rows;
    const stored = new Map(existing.map(row => [row.id, row]));
    for (let offset = 0; offset < manifest.artists.length; offset += 3) {
      await Promise.all(manifest.artists.slice(offset, offset + 3).map(async artist => {
        const target = FEATURED_ARTISTS.find(row => row.name === artist.name)!;
        const identities = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
        for (const song of artist.songs) {
          try {
            const saved = stored.get(song.id);
            if (saved) {
              if (!saved.available) throw new Error("This recording is disabled in the catalog. The importer preserves admin changes.");
              if (!identities.has(artistIdentity(saved.artist))) throw new Error("Stored artist metadata differs from this selection. Review it in the admin catalog.");
              reused++; continue;
            }
            const track = await getDeezerTrack(song.id);
            if (!track || !identities.has(artistIdentity(track.artist))) throw new Error("Original recording is no longer available under the selected artist.");
            if (!track.genre) track.genre = target.genre;
            await importTracks([track], "global-mix", undefined, { deferOrganization: true });
            imported++;
          } catch (error) { failures.push({ artist: artist.name, trackId: song.id, reason: error instanceof Error ? error.message : "Import failed." }); }
        }
        console.log(`${artist.name}: processed ${artist.songs.length} selected recordings.`);
      }));
    }
    const packs = await organizeCatalog();
    const active = (await pool.query<{ artist: string; count: number }>("SELECT t.artist,count(*)::integer AS count FROM tracks t JOIN pack_tracks p ON p.track_id=t.id WHERE p.pack_id='featured-hits' AND t.available=true GROUP BY t.artist ORDER BY t.artist")).rows;
    const coverage = FEATURED_ARTISTS.map(target => {
      const identities = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
      return { name: target.name, tracks: active.filter(row => identities.has(artistIdentity(row.artist))).reduce((total, row) => total + row.count, 0) };
    });
    const selectedIds = manifest.artists.flatMap(artist => artist.songs.map(song => song.id));
    const selectedActive = (await pool.query<{ count: number }>("SELECT count(*)::integer AS count FROM tracks t JOIN pack_tracks p ON p.track_id=t.id WHERE p.pack_id='featured-hits' AND t.available=true AND t.id=ANY($1::text[])", [selectedIds])).rows[0].count;
    const report = { checkedAt: new Date().toISOString(), imported, reused, failures, selectedActive, expectedSelected: selectedIds.length, completeArtists: coverage.filter(row => row.tracks >= manifest.songsPerArtist).length, coverage, pack: packs.find(pack => pack.id === "featured-hits"), productionActivated: false };
    await mkdir(".data/featured-hits", { recursive: true });
    await writeFile(".data/featured-hits/import-report.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Imported ${imported}; reused ${reused}; selected active ${selectedActive}/${selectedIds.length}; artist coverage ${report.completeArtists}/100; local pack ${report.pack?.count ?? 0} songs.`);
    if (failures.length || report.completeArtists !== 100 || selectedActive !== selectedIds.length) process.exitCode = 1;
  } finally { await pool.end(); }
}

if (values.help) console.log("bun run catalog:stars [--per-artist 5] [--output data/featured-hitmakers.json]\nbun run catalog:stars --import  # requires the private local database/configuration\nPreparation exports metadata only; no signed CDN URLs or full audio files.");
else (values.import ? importCollection() : prepare()).catch(error => { console.error(error instanceof Error ? error.message : "Featured collection failed."); process.exitCode = 1; });
