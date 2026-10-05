import { z } from "zod";
import type { Track } from "../shared/contracts";

const rawTrackSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1), duration: z.number().min(16).max(720),
  user: z.object({ name: z.string().min(1) }),
  is_streamable: z.literal(true), is_available: z.literal(true),
  is_stream_gated: z.boolean().optional(), is_unlisted: z.boolean().optional(),
  is_delete: z.boolean().optional(),
  genre: z.string().nullish(), play_count: z.number().nullish(),
  release_date: z.string().nullish(), permalink: z.string().nullish(),
  artwork: z.object({ "480x480": z.string().nullish(), "150x150": z.string().nullish() }).nullish(),
  license: z.string().nullish(),
});
// Audius' default rights label coexists with OML API access; private alternative licenses remain excluded.
const acceptedLicenses = new Set(["All rights reserved", "OML", "CC0", "CC BY", "CC BY-SA", "CC-BY", "CC-BY-SA"]);
const cleanText = (value: string) => value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 200);
const safeImage = (value: string | null | undefined) => {
  if (!value) return null;
  try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; }
};

export function normalizeAudiusTrack(raw: unknown): Track | null {
  const parsed = rawTrackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const song = parsed.data;
  if (song.is_stream_gated || song.is_unlisted || song.is_delete || (song.license && !acceptedLicenses.has(song.license))) return null;
  const releaseDate = song.release_date ? new Date(song.release_date) : null;
  const year = releaseDate && !Number.isNaN(releaseDate.getTime()) ? releaseDate.getUTCFullYear() : null;
  const permalink = song.permalink?.startsWith("/") && !song.permalink.startsWith("//") ? song.permalink : `/tracks/${song.id}`;
  return {
    id: `audius-${song.id}`, providerId: song.id, title: cleanText(song.title), artist: cleanText(song.user.name),
    artworkUrl: safeImage(song.artwork?.["480x480"] ?? song.artwork?.["150x150"]),
    duration: song.duration, genre: song.genre || null, releaseYear: year && year >= 1900 && year <= 2100 ? year : null,
    language: null, playCount: Math.max(0, Math.floor(song.play_count ?? 0)), clipStartSec: 0,
    sourceUrl: `https://audius.co${permalink}`, license: song.license || null, available: true,
  };
}
export function validatePlaylistUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && ["audius.co", "www.audius.co"].includes(url.hostname) && !url.username && !url.password && !url.port; } catch { return false; }
}
export class ProviderError extends Error {
  constructor(message = "The music service is unavailable. Please try again.", public status = 503) { super(message); }
}
export async function audiusGet(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const url = new URL(`https://api.audius.co/v1/${path}`);
  url.searchParams.set("app_name", process.env.AUDIUS_APP_NAME || "guess-the-song");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.AUDIUS_API_KEY) headers["x-api-key"] = process.env.AUDIUS_API_KEY;
  let response: Response;
  try { response = await fetch(url, { headers, signal: AbortSignal.timeout(20000), cache: "no-store" }); } catch { throw new ProviderError(); }
  if (!response.ok) throw new ProviderError(response.status === 429 ? "The music service is busy. Try again shortly." : undefined);
  const body = await response.json() as { data?: unknown };
  return body.data;
}
export async function searchAudius(query: string, limit = 25): Promise<Track[]> {
  const data = await audiusGet("tracks/search", { query: query.trim().slice(0, 100), limit: Math.min(100, limit) });
  return Array.isArray(data) ? data.map(normalizeAudiusTrack).filter((track): track is Track => !!track) : [];
}
export async function trendingAudius(offset = 0, limit = 100, genre?: string): Promise<Track[]> {
  const data = await audiusGet("tracks/trending", { limit: Math.min(100, limit), offset, time: "allTime", ...(genre ? { genre } : {}) });
  return Array.isArray(data) ? data.map(normalizeAudiusTrack).filter((track): track is Track => !!track) : [];
}
export async function getAudiusTrack(id: string): Promise<Track | null> {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return normalizeAudiusTrack(await audiusGet(`tracks/${id}`));
}
export async function getAudiusPlaylistTracks(value: string): Promise<Track[]> {
  if (!validatePlaylistUrl(value)) throw new ProviderError("Enter a public Audius playlist URL.", 400);
  const resolved = await audiusGet("resolve", { url: value });
  const playlistSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]+$/) });
  const parsed = playlistSchema.safeParse(Array.isArray(resolved) ? resolved[0] : resolved);
  if (!parsed.success) throw new ProviderError("That URL does not identify an Audius playlist.", 400);
  const data = await audiusGet(`playlists/${parsed.data.id}/tracks`);
  return Array.isArray(data) ? data.map(normalizeAudiusTrack).filter((track): track is Track => !!track).slice(0, 500) : [];
}
export async function streamAudius(providerId: string, range?: string | null): Promise<Response> {
  if (!/^[a-zA-Z0-9_-]+$/.test(providerId)) throw new ProviderError("This song is unavailable.");
  const headers: Record<string, string> = {};
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  const url = new URL(`https://api.audius.co/v1/tracks/${providerId}/stream`);
  url.searchParams.set("app_name", process.env.AUDIUS_APP_NAME || "guess-the-song");
  if (process.env.AUDIUS_API_KEY) headers["x-api-key"] = process.env.AUDIUS_API_KEY;
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000), redirect: "follow", cache: "no-store" });
    if (!response.ok || !response.body) throw new ProviderError("This song couldn't load. Retry without losing a guess.");
    return response;
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError("This song couldn't load. Retry without losing a guess."); }
}
