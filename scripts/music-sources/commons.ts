import { z } from "zod";
import { candidate, chooseLicense, credit, fetchJson, publicationDate, textValue, queryUrl, boundedLimit, type DiscoveryResult, type MusicCandidate, type SearchOptions } from "./shared";

const valueSchema = z.object({ value: z.union([z.string(), z.number()]) });
const infoSchema = z.object({
  duration: z.number(), url: z.string(), mime: z.string(), descriptionurl: z.string(),
  derivatives: z.array(z.object({ src: z.string(), type: z.string() })).optional(),
  extmetadata: z.record(z.string(), valueSchema),
});
const pageSchema = z.object({ pageid: z.number().int().positive(), title: z.string(), videoinfo: z.array(infoSchema).optional(), imageinfo: z.array(infoSchema).optional() });

export function normalizeCommons(input: unknown, nonCommercial = false): MusicCandidate | null {
  const parsed = pageSchema.safeParse(input); if (!parsed.success) return null;
  const page = parsed.data; const info = page.videoinfo?.[0] ?? page.imageinfo?.[0]; if (!info) return null;
  const meta = (key: string) => textValue(info.extmetadata[key]?.value);
  const license = chooseLicense(meta("LicenseUrl"), nonCommercial);
  if (!license || meta("Restrictions")) return null;
  const mp3 = info.derivatives?.find(file => file.type.split(";")[0] === "audio/mpeg");
  const audioMime = mp3 ? "audio/mpeg" : info.mime;
  if (!["audio/mpeg", "audio/ogg", "application/ogg"].includes(audioMime)) return null;
  const title = meta("ObjectName") || page.title.replace(/^File:/, "");
  const artist = meta("Artist") || meta("Credit");
  return candidate({
    id: `commons-${page.pageid}`, source: "commons", title, artist, durationSec: info.duration,
    genreTags: [], publishedAt: publicationDate(meta("DateTime")), releaseYear: null,
    audioUrl: mp3?.src ?? info.url, audioMime, sourceUrl: info.descriptionurl, license,
    attribution: credit(title, artist, info.descriptionurl, license, meta("Credit")), playerCompatible: audioMime === "audio/mpeg",
  });
}

export async function discoverCommons(options: SearchOptions): Promise<DiscoveryResult> {
  if (!options.query.trim()) throw new Error("Commons needs a focused search or a File: title.");
  const params: Record<string, string | number> = { action: "query", format: "json", formatversion: 2, prop: "videoinfo", viprop: "url|mime|size|extmetadata|derivatives" };
  if (options.query.startsWith("File:")) params.titles = options.query;
  else Object.assign(params, { generator: "search", gsrsearch: `filetype:audio ${options.query}`, gsrnamespace: 6, gsrlimit: boundedLimit(options.limit) });
  const raw = await fetchJson(queryUrl("https://commons.wikimedia.org/w/api.php", params));
  const response = z.object({ query: z.object({ pages: z.array(z.unknown()).optional() }).optional(), error: z.object({ info: z.string() }).optional() }).parse(raw);
  if (response.error) throw new Error(response.error.info);
  const pages = response.query?.pages ?? [];
  const candidates = pages.map(page => normalizeCommons(page, options.nonCommercial)).filter((row): row is MusicCandidate => !!row);
  return { source: "commons", fetched: pages.length, accepted: candidates.length, candidates: candidates.slice(0, boundedLimit(options.limit)) };
}
