import { z } from "zod";
import { ProviderError } from "./audius";
import { boundedMusicClip } from "./audio-clips";
import { deezerGet, deezerPreviewsEnabled, getDeezerTrack, normalizeDeezerTrack } from "./deezer";
import type { Track } from "../shared/contracts";

export const previewCheckSchema = z.object({ trackIds: z.array(z.string().regex(/^deezer-[1-9]\d*$/)).min(1).max(20) }).strict();
type PreviewCheck = { id: string; playable: boolean; track: Track | null; issue?: string };

export async function checkDeezerPreviews(ids: string[], env: Record<string, string | undefined> = process.env): Promise<PreviewCheck[]> {
  if (!deezerPreviewsEnabled(env)) throw new ProviderError("This music source is disabled for this application.");
  const unique = [...new Set(previewCheckSchema.parse({ trackIds: ids }).trackIds)];
  const result: PreviewCheck[] = [];
  for (let offset = 0; offset < unique.length; offset += 3) {
    result.push(...await Promise.all(unique.slice(offset, offset + 3).map(async id => {
      try {
        // Run in the deployment's own provider region. Local availability alone
        // does not prove that a hosted function can play the same edition.
        const track = await getDeezerTrack(id);
        if (!track) return { id, playable: false, track: null, issue: "No readable official preview in this deployment." };
        await boundedMusicClip(track.providerId, 0, 1);
        return { id, playable: true, track };
      } catch { return { id, playable: false, track: null, issue: "The preview could not be verified. Retry before importing." }; }
    })));
  }
  return result;
}

export async function searchDeezerPreviews(query: string) {
  if (!deezerPreviewsEnabled()) throw new ProviderError("This music source is disabled for this application.");
  const q = z.string().trim().min(2).max(100).parse(query);
  const response = z.object({ data: z.array(z.unknown()) }).parse(await deezerGet("search", { q, limit: 50 }));
  return response.data.flatMap(raw => {
    const track = normalizeDeezerTrack(raw);
    const artist = z.object({ artist: z.object({ id: z.number().int().positive() }), album: z.object({ id: z.number().int().positive() }), title_short: z.string().optional() }).safeParse(raw);
    return track && artist.success ? [{ ...track, primaryArtistId: artist.data.artist.id, albumId: artist.data.album.id, titleShort: artist.data.title_short || track.title }] : [];
  });
}
