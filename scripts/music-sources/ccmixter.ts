import { z } from "zod";
import { candidate, chooseLicense, credit, fetchJson, textValue, parseDuration, queryUrl, boundedLimit, type DiscoveryResult, type MusicCandidate, type SearchOptions } from "./shared";

const genres: Record<string, string> = { hip_hop: "Hip-Hop/Rap", rap: "Rap", pop: "Pop", rock: "Rock", indie: "Indie", alternative: "Alternative", electronic: "Electronic", electronica: "Electronic", ambient: "Ambient", house: "House", techno: "Techno", jazz: "Jazz", blues: "Blues", classical: "Classical", reggae: "Reggae", folk: "Folk", country: "Country", dubstep: "Dubstep", dance: "Dance" };
const mixterSchema = z.object({
  upload_id: z.number().int().positive(), upload_name: z.string(), user_real_name: z.string().optional(), user_name: z.string().optional(),
  file_page_url: z.string(), license_url: z.string(),
  upload_extra: z.object({ featuring: z.string().optional(), usertags: z.string().optional(), nsfw: z.boolean().optional() }).optional(),
  files: z.array(z.object({ download_url: z.string(), file_is_remote: z.union([z.number(), z.string()]).optional(), file_format_info: z.object({ mime_type: z.string().optional(), ps: z.string().optional() }) })),
});

export function normalizeCCMixter(input: unknown, nonCommercial = false): MusicCandidate | null {
  const parsed = mixterSchema.safeParse(input); if (!parsed.success) return null;
  const row = parsed.data; const license = chooseLicense(row.license_url, nonCommercial);
  if (!license || row.upload_extra?.nsfw) return null;
  const file = row.files.find(file => file.file_format_info.mime_type === "audio/mpeg" && Number(file.file_is_remote ?? 0) === 0);
  const duration = parseDuration(file?.file_format_info.ps); if (!file || !duration) return null;
  const artist = textValue(row.user_real_name || row.user_name);
  const title = textValue(row.upload_name);
  const tags = row.upload_extra?.usertags?.split(",").map(tag => tag.trim().toLowerCase()) ?? [];
  return candidate({
    id: `ccmixter-${row.upload_id}`, source: "ccmixter", title, artist, durationSec: duration,
    genreTags: [...new Set(tags.flatMap(tag => genres[tag] ? [genres[tag]] : []))], publishedAt: null, releaseYear: null,
    audioUrl: file.download_url, audioMime: "audio/mpeg", sourceUrl: row.file_page_url, license,
    attribution: credit(title, artist, row.file_page_url, license, row.upload_extra?.featuring ? `Featuring ${textValue(row.upload_extra.featuring)}` : ""), playerCompatible: true,
  });
}

export async function discoverCCMixter(options: SearchOptions): Promise<DiscoveryResult> {
  const query = options.query.trim();
  const params: Record<string, string | number> = { f: "json", limit: boundedLimit(options.limit), sort: "rank", reqtags: "remix" };
  if (!options.nonCommercial) params.lic = "by";
  if (genres[query]) params.tags = query;
  else if (query) Object.assign(params, { search: query, search_type: "all" });
  const raw = await fetchJson(queryUrl("https://ccmixter.org/api/query", params));
  if (!Array.isArray(raw)) throw new Error("The ccMixter query did not return a JSON array.");
  const accepted = raw.map(row => normalizeCCMixter(row, options.nonCommercial)).filter((row): row is MusicCandidate => !!row);
  return { source: "ccmixter", fetched: raw.length, accepted: accepted.length, candidates: accepted.slice(0, boundedLimit(options.limit)) };
}
