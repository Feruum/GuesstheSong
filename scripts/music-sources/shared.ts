import { z } from "zod";

export type MusicSource = "incompetech" | "commons" | "ccmixter" | "openverse";
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export interface MusicLicense { code: string; version: string; url: string; commercial: boolean }
export interface MusicCandidate {
  id: string; source: MusicSource; title: string; artist: string;
  durationSec: number; genreTags: string[]; publishedAt: string | null; releaseYear: null;
  audioUrl: string; audioMime: string; sourceUrl: string;
  license: MusicLicense; attribution: string; playerCompatible: boolean;
}
export interface SearchOptions { query: string; limit: number; nonCommercial?: boolean }
export interface DiscoveryResult { source: MusicSource; fetched: number; accepted: number; candidates: MusicCandidate[] }
export interface AudioProbe { ok: boolean; status: number | null; bytesRead: number; mime: string | null; error?: string }

const agent = "GuessTheSong/1.0 (music discovery; https://github.com/Feruum/GuesstheSong)";
const maxMetadataBytes = 2_000_000;
const maxAudioBytes = 65_536;
const candidateSchema = z.object({
  id: z.string().min(1).max(160), source: z.enum(["incompetech", "commons", "ccmixter", "openverse"]),
  title: z.string().min(1).max(300), artist: z.string().min(1).max(500),
  durationSec: z.number().min(16).max(86_400), genreTags: z.array(z.string().max(100)).max(30),
  publishedAt: z.string().nullable(), releaseYear: z.null(), audioUrl: z.string().url(), audioMime: z.string(),
  sourceUrl: z.string().url(), license: z.object({ code: z.string(), version: z.string(), url: z.string().url(), commercial: z.boolean() }),
  attribution: z.string().min(1).max(4000), playerCompatible: z.boolean(),
});

export class MusicSourceError extends Error {
  constructor(message: string, public status?: number, public retryAfter?: string | null) { super(message); }
}

export function textValue(input: unknown): string {
  if (typeof input !== "string") return "";
  const entities: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return input.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (original, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? original;
      const value = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    }).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function chooseLicense(input: unknown, nonCommercial = false): MusicLicense | null {
  if (typeof input !== "string") return null;
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol) || !["creativecommons.org", "www.creativecommons.org"].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/(?:deed\.[a-z-]+|legalcode)\/?$/i, "/");
    const publicDomain = /^\/publicdomain\/(zero|mark)\/1\.0\/?$/.exec(path);
    if (publicDomain) return { code: publicDomain[1] === "zero" ? "cc0" : "pdm", version: "1.0", url: `https://creativecommons.org/publicdomain/${publicDomain[1]}/1.0/`, commercial: true };
    const match = /^\/licenses\/(by|by-sa|by-nc|by-nc-sa)\/(1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/([a-z]{2}))?\/?$/.exec(path);
    if (!match || (match[1].includes("nc") && !nonCommercial)) return null;
    return { code: match[1], version: match[2], url: `https://creativecommons.org/licenses/${match[1]}/${match[2]}/${match[3] ? `${match[3]}/` : ""}`, commercial: !match[1].includes("nc") };
  } catch { return null; }
}

export function parseDuration(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) && input > 0 ? input : null;
  if (typeof input !== "string" || !/^\d+(?::\d{1,2})?(?::\d{1,2}(?:\.\d+)?)?$/.test(input)) return null;
  const parts = input.split(":").map(Number);
  if (parts.length > 1 && parts.slice(1).some(part => part >= 60)) return null;
  const result = parts.reduce((total, part) => total * 60 + part, 0);
  return result > 0 ? result : null;
}

export function publicationDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(date);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function providerUrl(input: string, kind: "api" | "media" | "page"): URL {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new MusicSourceError("Only provider-owned HTTPS URLs are allowed.");
  const path = url.pathname;
  const valid = kind === "api" ? (
    (url.hostname === "incompetech.com" && /^\/music\/royalty-free\/(pieces\.json|index\.html)$/.test(path)) ||
    (url.hostname === "ccmixter.org" && path === "/api/query") ||
    (url.hostname === "commons.wikimedia.org" && path === "/w/api.php") ||
    (url.hostname === "api.openverse.org" && /^\/v1\/audio\//.test(path))
  ) : kind === "media" ? (
    (url.hostname === "incompetech.com" && path.startsWith("/music/royalty-free/mp3-royaltyfree/")) ||
    (url.hostname === "ccmixter.org" && path.startsWith("/content/")) ||
    (url.hostname === "upload.wikimedia.org" && path.startsWith("/wikipedia/commons/"))
  ) : (
    (url.hostname === "incompetech.com" && path.startsWith("/music/royalty-free/")) ||
    (url.hostname === "ccmixter.org" && path.startsWith("/files/")) ||
    (url.hostname === "commons.wikimedia.org" && (path.startsWith("/wiki/") || path === "/w/index.php"))
  );
  if (!valid) throw new MusicSourceError("This provider URL is outside the supported API or audio paths.");
  return url;
}

export function candidate(input: MusicCandidate): MusicCandidate | null {
  try { providerUrl(input.audioUrl, "media"); providerUrl(input.sourceUrl, "page"); }
  catch { return null; }
  const parsed = candidateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function credit(title: string, artist: string, sourceUrl: string, license: MusicLicense, extra = ""): string {
  return [`${title} — ${artist}`, extra, sourceUrl, `${license.code.toUpperCase()} ${license.version}: ${license.url}`].filter(Boolean).join(" · ");
}

async function responseFor(url: string, kind: "api" | "media", fetcher: Fetcher, headers?: Record<string, string>): Promise<Response> {
  let target = providerUrl(url, kind);
  const signal = AbortSignal.timeout(15_000);
  for (let hop = 0; hop <= 3; hop++) {
    const response = await fetcher(target.href, { signal, redirect: "manual", credentials: "omit", headers: { "User-Agent": agent, ...headers } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || hop === 3) throw new MusicSourceError("The provider returned an invalid redirect.");
    target = providerUrl(new URL(location, target).href, kind);
  }
  throw new MusicSourceError("Too many provider redirects.");
}

async function readBounded(response: Response, limit: number, strict: boolean): Promise<Buffer> {
  if (!response.body) throw new MusicSourceError("The provider returned an empty body.");
  if (strict && Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel(); throw new MusicSourceError("The provider response is too large.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const next = await reader.read(); if (next.done) break;
      const remaining = limit - size;
      if (strict && next.value.length > remaining) throw new MusicSourceError("The provider response is too large.");
      const chunk = next.value.subarray(0, remaining); chunks.push(chunk); size += chunk.length;
    }
    if (strict && size === limit) {
      const next = await reader.read(); if (!next.done) throw new MusicSourceError("The provider response is too large.");
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

export async function fetchText(url: string, fetcher: Fetcher = fetch): Promise<string> {
  const response = await responseFor(url, "api", fetcher, { Accept: "application/json,text/html;q=0.8" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new MusicSourceError(`The provider returned HTTP ${response.status}.`, response.status, response.headers.get("retry-after"));
  }
  return (await readBounded(response, maxMetadataBytes, true)).toString("utf8");
}

export async function fetchJson(url: string, fetcher: Fetcher = fetch): Promise<unknown> {
  const body = await fetchText(url, fetcher);
  try { return JSON.parse(body); } catch { throw new MusicSourceError("The provider returned invalid JSON."); }
}

export async function probeAudio(url: string, fetcher: Fetcher = fetch): Promise<AudioProbe> {
  let status: number | null = null;
  let mime: string | null = null;
  try {
    const response = await responseFor(url, "media", fetcher, { Range: `bytes=0-${maxAudioBytes - 1}`, Accept: "audio/*" });
    status = response.status; mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? null;
    if (![200, 206].includes(status)) { await response.body?.cancel(); return { ok: false, status, bytesRead: 0, mime, error: `HTTP ${status}` }; }
    const data = await readBounded(response, maxAudioBytes, false);
    const mpeg = data.toString("ascii", 0, 3) === "ID3" || (data.length > 1 && data[0] === 0xff && (data[1] & 0xe0) === 0xe0);
    const ogg = data.toString("ascii", 0, 4) === "OggS";
    const ok = (mpeg && ["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(mime ?? "")) || (ogg && ["audio/ogg", "application/ogg", "application/octet-stream"].includes(mime ?? ""));
    return { ok, status, bytesRead: data.length, mime, ...(ok ? {} : { error: "The response is not recognized MPEG/OGG audio." }) };
  } catch (error) { return { ok: false, status, bytesRead: 0, mime, error: error instanceof Error ? error.message : "Audio verification failed." }; }
}

export function uniqueAudio(tracks: MusicCandidate[]): MusicCandidate[] {
  const seen = new Set<string>();
  return tracks.filter(track => {
    const url = new URL(track.audioUrl);
    if (url.hostname === "upload.wikimedia.org") { url.search = ""; url.hash = ""; }
    const key = url.href;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function queryUrl(base: string, params: Record<string, string | number>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.href;
}
export const boundedLimit = (limit: number, maximum = 50) => Math.max(1, Math.min(maximum, Math.floor(limit)));
export function matchesQuery(track: MusicCandidate, query: string): boolean {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = `${track.title} ${track.artist} ${track.genreTags.join(" ")}`.toLowerCase();
  return words.every(word => text.includes(word));
}
