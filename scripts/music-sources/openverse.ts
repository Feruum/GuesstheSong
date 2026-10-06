import { z } from "zod";
import { candidate, chooseLicense, credit, fetchJson, queryUrl, boundedLimit, textValue, type DiscoveryResult, type MusicCandidate, type SearchOptions } from "./shared";

const recordSchema = z.object({ id: z.string().uuid(), title: z.string(), creator: z.string(), duration: z.number(), license: z.string(), license_version: z.string(), url: z.string(), foreign_landing_url: z.string() });

export function normalizeOpenverse(input: unknown, nonCommercial = false): MusicCandidate | null {
  const parsed = recordSchema.safeParse(input); if (!parsed.success) return null;
  const row = parsed.data;
  const licenseUrl = row.license === "cc0" || row.license === "pdm"
    ? `https://creativecommons.org/publicdomain/${row.license === "cc0" ? "zero" : "mark"}/${row.license_version}/`
    : `https://creativecommons.org/licenses/${row.license}/${row.license_version}/`;
  const license = chooseLicense(licenseUrl, nonCommercial); if (!license) return null;
  let audioMime: string;
  try {
    const path = new URL(row.url).pathname;
    audioMime = /\.mp3$/i.test(path) ? "audio/mpeg" : /\.ogg$/i.test(path) ? "audio/ogg" : "";
  } catch { return null; }
  if (!audioMime) return null;
  const title = textValue(row.title), artist = textValue(row.creator);
  return candidate({
    id: `openverse-${row.id}`, source: "openverse", title, artist, durationSec: row.duration / 1000,
    genreTags: [], publishedAt: null, releaseYear: null, audioUrl: row.url, audioMime, sourceUrl: row.foreign_landing_url, license,
    attribution: credit(title, artist, row.foreign_landing_url, license), playerCompatible: audioMime === "audio/mpeg",
  });
}

export async function discoverOpenverse(options: SearchOptions): Promise<DiscoveryResult> {
  if (!options.query.trim()) throw new Error("Openverse needs a focused query; bulk catalog scraping is not supported.");
  const limit = boundedLimit(options.limit, 20);
  const raw = await fetchJson(queryUrl("https://api.openverse.org/v1/audio/", { q: options.query, page_size: limit, license: options.nonCommercial ? "by,by-sa,by-nc,by-nc-sa,cc0,pdm" : "by,by-sa,cc0,pdm" }));
  const response = z.object({ results: z.array(z.unknown()) }).parse(raw);
  const candidates = response.results.map(row => normalizeOpenverse(row, options.nonCommercial)).filter((row): row is MusicCandidate => !!row);
  return { source: "openverse", fetched: response.results.length, accepted: candidates.length, candidates: candidates.slice(0, limit) };
}
