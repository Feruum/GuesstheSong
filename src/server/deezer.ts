import { z } from "zod";
import type { Track } from "../shared/contracts";
import { ProviderError } from "./audius";

// Public deployment must use a separately authorized music source. These official
// previews are opt-in for the current private, noncommercial loopback application.
export function privatePreviewsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DEEZER_PRIVATE_PREVIEWS !== "true" || !env.APP_URL) return false;
  try {
    const url = new URL(env.APP_URL);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function safeDeezerPreviewUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "cdnt-preview.dzcdn.net" && !url.username && !url.password && !url.port && url.pathname.endsWith(".mp3") ? url.href : null;
  } catch { return null; }
}

const rawTrackSchema = z.object({
  id: z.number().int().positive(), title: z.string().min(1), duration: z.number().min(16),
  readable: z.literal(true), preview: z.string(), rank: z.number().nonnegative().optional(),
  artist: z.object({ id: z.number().int().positive(), name: z.string().min(1) }),
  album: z.object({ id: z.number().int().positive(), cover_medium: z.string().optional() }),
  release_date: z.string().optional(),
});
const albumSchema = z.object({ release_date: z.string().optional(), genres: z.object({ data: z.array(z.object({ name: z.string() })) }).optional() });
const genreMap: Record<string, string> = { "Rap/Hip Hop": "Hip-Hop/Rap", "R&B": "R&B/Soul", "Alternative": "Alternative", "Indie Pop": "Alternative", "Indie Rock": "Alternative", "Latin Music": "Latin", Dance: "Electronic" };
const clean = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);

export function normalizeDeezerTrack(raw: unknown, album?: unknown): Track | null {
  const parsed = rawTrackSchema.safeParse(raw);
  if (!parsed.success || !safeDeezerPreviewUrl(parsed.data.preview)) return null;
  const song = parsed.data;
  const metadata = albumSchema.safeParse(album).data;
  const date = song.release_date || metadata?.release_date;
  const year = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Number(date.slice(0, 4)) : null;
  const genre = metadata?.genres?.data.find(item => item.name && item.name !== "All")?.name || null;
  let artworkUrl: string | null = null;
  try { const url = new URL(song.album.cover_medium || ""); if (url.protocol === "https:" && ["cdn-images.dzcdn.net", "e-cdns-images.dzcdn.net"].includes(url.hostname)) artworkUrl = url.href; } catch { /* Artwork is optional. */ }
  return {
    id: `deezer-${song.id}`, providerId: `deezer-${song.id}`, title: clean(song.title), artist: clean(song.artist.name),
    artworkUrl, duration: Math.min(30, Math.floor(song.duration)), genre: genre ? genreMap[genre] || genre : null,
    releaseYear: year && year >= 1900 && year <= 2100 ? year : null, language: null,
    playCount: 0, popularityScore: Math.floor(song.rank || 0), clipStartSec: 0,
    sourceUrl: `https://www.deezer.com/track/${song.id}`, license: "Official preview · Private noncommercial listening", available: true,
  };
}

let requestSlot = 0;
export class DeezerMissingError extends ProviderError {
  constructor() { super("This recording is no longer available from the preview service.", 404); }
}
export async function deezerGet(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  if (!/^(?:artist|album|track|search\/artist|genre)(?:\/\d+)?(?:\/top)?$/.test(path)) throw new ProviderError("Invalid music request.", 400);
  const url = new URL(`https://api.deezer.com/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      // Reserve spaced request starts across import workers. Provider throttling
      // can also be reported as HTTP 200 with error code 4.
      const wait = Math.max(0, requestSlot - Date.now());
      requestSlot = Math.max(Date.now(), requestSlot) + 150;
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), cache: "no-store" });
      if (response.status === 404 || response.status === 410) throw new DeezerMissingError();
      const data: unknown = await response.json();
      const error = z.object({ error: z.object({ code: z.number() }) }).safeParse(data);
      if (error.success && error.data.error.code === 800) throw new DeezerMissingError();
      if (response.status === 429 || (error.success && error.data.error.code === 4)) {
        if (attempt < 2) { await new Promise(resolve => setTimeout(resolve, 2500 * (attempt + 1))); continue; }
        throw new ProviderError("The preview service is busy. Try again shortly.");
      }
      if (!response.ok || !data || typeof data !== "object" || "error" in data) throw new ProviderError("The preview service couldn't load this song.");
      return data;
    }
    throw new ProviderError();
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError("The preview service is unavailable. Try again shortly."); }
}

export async function getDeezerTrack(providerId: string): Promise<Track | null> {
  if (!privatePreviewsEnabled() || !/^deezer-\d+$/.test(providerId)) return null;
  let raw: unknown;
  try { raw = await deezerGet(`track/${providerId.slice(7)}`); }
  catch (error) { if (error instanceof DeezerMissingError) return null; throw error; }
  const parsed = rawTrackSchema.safeParse(raw);
  if (!parsed.success) return null;
  let album: unknown;
  try { album = await deezerGet(`album/${parsed.data.album.id}`); }
  catch (error) { if (!(error instanceof DeezerMissingError)) throw error; }
  return normalizeDeezerTrack(raw, album);
}

export async function streamDeezerPreview(providerId: string, range?: string): Promise<Response> {
  if (!privatePreviewsEnabled() || !/^deezer-\d+$/.test(providerId)) throw new ProviderError("This preview is only enabled for the private local game.");
  // Resolve fresh signed CDN URLs on the server; never expose a provider URL or
  // accept one from the client. No authentication, DRM, or geographic bypass.
  const raw = await deezerGet(`track/${providerId.slice(7)}`);
  const parsed = rawTrackSchema.safeParse(raw);
  const preview = parsed.success ? safeDeezerPreviewUrl(parsed.data.preview) : null;
  if (!preview) throw new ProviderError("This song has no available preview. Try another song.");
  try {
    const response = await fetch(preview, { headers: range ? { Range: range } : {}, signal: AbortSignal.timeout(20000), redirect: "error", cache: "no-store" });
    if (!response.ok || !response.body || !/audio\/mpeg|application\/octet-stream/.test(response.headers.get("Content-Type") || "")) throw new ProviderError();
    return response;
  } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError("This preview couldn't load. Your guesses are saved."); }
}
