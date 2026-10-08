import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { EXPANDED_ARTISTS, CURATED_ARTIST_PACKS } from "../src/shared/expanded-artists";
import { artistIdentity, type FeaturedArtist } from "../src/shared/featured-artists";
import { deezerGet, deezerPreviewsEnabled } from "../src/server/deezer";
import { importTracks, organizeCatalog } from "../src/server/catalog";
import { getPool } from "../src/server/db";
import type { Track } from "../src/shared/contracts";
import { resolveFeaturedArtist } from "./music-sources/featured-hits";
import { artistCandidateSchema, sourceTrackSchema, selectArtistCandidates, recordingIdentity, type ArtistCandidate } from "./music-sources/artist-packs";

const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false, options: {
  import: { type: "boolean", default: false }, "per-artist": { type: "string", default: "10" },
  origin: { type: "string" }, "password-file": { type: "string" }, output: { type: "string", default: "data/expanded-artists.json" },
  help: { type: "boolean", short: "h", default: false },
} });
const searchSchema = z.object({ tracks: z.array(artistCandidateSchema) });
const checkSchema = z.object({ results: z.array(z.object({ id: z.string(), playable: z.boolean(), track: sourceTrackSchema.nullable() })) });
const escape = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\[\]`*<>|]/g, "\\$&");
type VerifiedSong = { id: string; title: string; artist: string; albumId: number; genre: string | null; releaseYear: number | null; sourceUrl: string; verifiedAt: string };
type ArtistResult = { name: string; category: string; artistId: number; songs: VerifiedSong[] };

async function run() {
  if (!deezerPreviewsEnabled()) throw new Error("Configure enabled previews for the intended application before checking this source.");
  const originUrl = new URL(values.origin || process.env.APP_URL || "");
  if (originUrl.origin !== new URL(process.env.APP_URL || "").origin || originUrl.username || originUrl.password || originUrl.pathname !== "/" || originUrl.search || originUrl.hash) throw new Error("The verification origin must match APP_URL without credentials or extra URL parts.");
  const origin = originUrl.origin;
  const perArtist = Number(values["per-artist"]);
  if (!Number.isInteger(perArtist) || perArtist < 10 || perArtist > 20) throw new Error("Choose 10–20 distinct songs per artist.");
  const output = resolve(values.output);
  if (!output.endsWith(".json") || !["data", ".data"].some(directory => {
    const path = relative(resolve(directory), output);
    return path && !path.startsWith("..") && !isAbsolute(path);
  })) throw new Error("Save public metadata inside data/ or private progress inside .data/ as JSON.");
  if (!values["password-file"]) throw new Error("Pass --password-file with the path to the existing catalog administrator password. Never put the password in command arguments.");
  const password = (await readFile(values["password-file"], "utf8")).trim();
  const login = await fetch(`${origin}/api/v1/admin/login`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(30000) });
  const cookie = login.headers.getSetCookie().find(value => value.startsWith("gts_admin="))?.split(";")[0];
  if (!login.ok || !cookie) throw new Error(`Catalog administrator login failed (HTTP ${login.status}); no credentials were printed.`);
  async function request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${origin}/api/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie!, Origin: origin, ...body !== undefined ? { "Content-Type": "application/json" } : {} }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Hosted catalog request failed (HTTP ${response.status}).`);
    return response.json();
  }
  const artists: ArtistResult[] = [], verifiedTracks: Track[] = [];
  await mkdir(dirname(output), { recursive: true });
  await mkdir(".data/artist-packs", { recursive: true });
  const snapshot = () => ({ checkedAt: new Date().toISOString(), verifiedOrigin: origin, verifiedClipSeconds: 1, songsPerArtist: perArtist,
    selection: "Curated original artist recordings; not a chart ranking", playbackScope: "metadata-only", artists });
  try {
    for (const target of EXPANDED_ARTISTS) {
      const artist = await resolveArtist(target);
      const result: ArtistResult = { name: target.name, category: target.genre, artistId: artist.id, songs: [] };
      const aliases = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
      const candidates: ArtistCandidate[] = [], checkedIds = new Set<string>(), titles = new Set<string>();
      for (const name of [target.name, ...target.aliases ?? []]) {
        let emptyPages = 0;
        for (let offset = 0; offset <= 300 && result.songs.length < perArtist; offset += 50) {
          const page = searchSchema.parse(await request(`/admin/deezer/search?q=${encodeURIComponent(name)}&offset=${offset}`)).tracks;
          const originals = page.filter(row => row.primaryArtistId === artist.id);
          emptyPages = originals.length ? 0 : emptyPages + 1;
          candidates.push(...originals);
          while (result.songs.length < perArtist) {
            const batch = selectArtistCandidates(candidates.filter(row => !checkedIds.has(row.id) && !titles.has(recordingIdentity(row.titleShort))), target, artist.id, Math.min(10, perArtist - result.songs.length));
            if (!batch.length) break;
            batch.forEach(row => checkedIds.add(row.id));
            const checked = checkSchema.parse(await request("/admin/deezer/check", { trackIds: batch.map(row => row.id) })).results;
            for (const row of checked) {
              const candidate = batch.find(item => item.id === row.id), track = row.track;
              if (!row.playable || !track || !candidate || track.id !== candidate.id || !track.available || !aliases.has(artistIdentity(track.artist)) || titles.has(recordingIdentity(candidate.titleShort))) continue;
              // Fresh album metadata stays intact. Artist membership does not infer a track's language or release date.
              verifiedTracks.push(track); titles.add(recordingIdentity(candidate.titleShort));
              result.songs.push({ id: track.id, title: track.title, artist: track.artist, albumId: candidate.albumId, genre: track.genre,
                releaseYear: track.releaseYear, sourceUrl: track.sourceUrl, verifiedAt: new Date().toISOString() });
            }
          }
          if (emptyPages >= 2) break;
        }
        if (result.songs.length >= perArtist) break;
      }
      artists.push(result);
      await writeFile(".data/artist-packs/progress.json", `${JSON.stringify({ ...snapshot(), verifiedTracks }, null, 2)}\n`);
      console.log(`${artists.length}/${EXPANDED_ARTISTS.length} ${target.name}: ${result.songs.length}/${perArtist} hosted playable originals.`);
    }
    let imported = 0, reused = 0;
    if (values.import) {
      const pool = getPool();
      const existing = new Map((await pool.query<{ id: string; artist: string; available: boolean }>("SELECT id,artist,available FROM tracks WHERE id=ANY($1::text[])", [verifiedTracks.map(track => track.id)])).rows.map(row => [row.id, row]));
      const safe = verifiedTracks.filter(track => {
        const saved = existing.get(track.id);
        return !saved || saved.available && artistIdentity(saved.artist) === artistIdentity(track.artist);
      });
      const accepted = new Set(safe.map(track => track.id));
      artists.forEach(artist => { artist.songs = artist.songs.filter(song => accepted.has(song.id)); });
      reused = safe.filter(track => existing.has(track.id)).length;
      imported = safe.length - reused;
      await importTracks(safe, "global-mix", undefined, { deferOrganization: true });
      const packs = await organizeCatalog();
      console.log(JSON.stringify({ imported, reused, packs: packs.filter(pack => CURATED_ARTIST_PACKS.some(row => row.id === pack.id) || pack.id === "global-mix" || pack.id === "featured-hits").map(({ id, count }) => ({ id, count })) }));
    }
    const manifest = { ...snapshot(), imported: values.import, newTracks: imported, reusedTracks: reused };
    await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(output.replace(/\.json$/, ".md"), `# Дополнительные артисты — полный список\n\nПроверено ${manifest.checkedAt} на [сервере игры](${origin}): ${artists.filter(artist => artist.songs.length).length} артистов, ${artists.reduce((sum, artist) => sum + artist.songs.length, 0)} разных записей. Для каждой проверено реальное воспроизведение секундного клипа. Импорт в каталог: ${values.import ? "выполнен" : "не выполнялся"}. Цель — до ${perArtist} песен на артиста; фактические количества показаны ниже. Доступность превью может меняться. Это редакционная подборка, не рейтинг.\n\nНовые подборки: ${CURATED_ARTIST_PACKS.map(pack => `[${pack.name}](${origin}/packs/${pack.id})`).join(" · ")}. Moby добавлен в общий каталог и подборки по метаданным альбомов. Жанры и даты песен взяты у провайдера, язык без подтверждения остаётся неизвестным. Этот файл содержит только метаданные и ссылки на источник.\n\n| Артист | Категория подборки | Песен | Записи |\n| --- | --- | --- | --- |\n${artists.map(artist => `| ${escape(artist.name)} | ${escape(artist.category)} | ${artist.songs.length} | ${artist.songs.map(song => `[${escape(song.title)}](${song.sourceUrl})`).join(" · ") || "Нет доступных оригинальных превью при проверке"} |`).join("\n")}\n`);
    console.log(`Saved ${output}: ${artists.reduce((sum, artist) => sum + artist.songs.length, 0)} verified recordings.`);
  } finally {
    await request("/admin/logout", {}).catch(() => undefined);
    if (values.import) await getPool().end();
  }
}

async function resolveArtist(target: FeaturedArtist) {
  for (const name of [target.name, ...target.aliases ?? []]) {
    const response = z.object({ data: z.array(z.unknown()) }).parse(await deezerGet("search/artist", { q: name, limit: 25 }));
    const artist = resolveFeaturedArtist(target, response.data);
    if (artist) return artist;
  }
  throw new Error(`No exact established artist identity found for ${target.name}.`);
}

if (values.help) console.log("bun run catalog:artists --password-file <private-file> [--origin <APP_URL>] [--per-artist 10] [--output data/expanded-artists.json] [--import]\nSearch and audio checks run through the signed-in catalog administrator on the configured deployment. Without --import, only metadata is exported. Never commit the password file.");
else run().catch(error => { console.error(error instanceof Error ? error.message : "Artist collection import failed."); process.exitCode = 1; });
