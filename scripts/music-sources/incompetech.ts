import { z } from "zod";
import { candidate, chooseLicense, credit, fetchJson, fetchText, matchesQuery, parseDuration, publicationDate, boundedLimit, type DiscoveryResult, type MusicCandidate, type SearchOptions } from "./shared";

const pieceSchema = z.object({ title: z.string(), filename: z.string(), length: z.string(), genre: z.union([z.string(), z.number()]).optional(), isrc: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/), uploaded: z.string().optional() });
const genresSchema = z.array(z.object({ id: z.number().int().min(0).max(999), genre: z.string().max(100) }));

export function parseIncompetechGenres(html: string): Record<string, string> {
  const literal = /\bconst\s+genres\s*=\s*(\[[\s\S]*?\])\s*;/.exec(html)?.[1];
  if (!literal) return {};
  try {
    const parsed = genresSchema.safeParse(JSON.parse(literal));
    return parsed.success ? Object.fromEntries(parsed.data.map(row => [String(row.id), row.genre])) : {};
  } catch { return {}; }
}

export function normalizeIncompetech(input: unknown, genres: Record<string, string>): MusicCandidate | null {
  const parsed = pieceSchema.safeParse(input); if (!parsed.success) return null;
  const row = parsed.data;
  if (!row.title.trim() || !/\.mp3$/i.test(row.filename) || /[\\/:%?#]/.test(row.filename) || row.filename.includes("..")) return null;
  const duration = parseDuration(row.length); if (!duration || duration < 16) return null;
  const license = chooseLicense("https://creativecommons.org/licenses/by/4.0/")!;
  const sourceUrl = `https://incompetech.com/music/royalty-free/index.html?isrc=${row.isrc}`;
  const genre = genres[String(row.genre)];
  return candidate({
    id: `incompetech-${row.isrc}`, source: "incompetech", title: row.title.trim(), artist: "Kevin MacLeod", durationSec: duration,
    genreTags: genre ? [genre] : [], publishedAt: publicationDate(row.uploaded), releaseYear: null,
    audioUrl: `https://incompetech.com/music/royalty-free/mp3-royaltyfree/${encodeURIComponent(row.filename)}`, audioMime: "audio/mpeg",
    sourceUrl, license, attribution: credit(row.title.trim(), "Kevin MacLeod (incompetech.com)", sourceUrl, license), playerCompatible: true,
  });
}

export async function discoverIncompetech(options: SearchOptions): Promise<DiscoveryResult> {
  const [raw, html] = await Promise.all([
    fetchJson("https://incompetech.com/music/royalty-free/pieces.json"),
    fetchText("https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400011"),
  ]);
  if (!Array.isArray(raw)) throw new Error("The Incompetech catalog is not a JSON array.");
  const genres = parseIncompetechGenres(html);
  const accepted = raw.map(row => normalizeIncompetech(row, genres)).filter((row): row is MusicCandidate => !!row);
  return { source: "incompetech", fetched: raw.length, accepted: accepted.length, candidates: accepted.filter(row => matchesQuery(row, options.query)).slice(0, boundedLimit(options.limit)) };
}
