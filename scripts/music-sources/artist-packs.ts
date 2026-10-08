import { z } from "zod";
import type { Track } from "../../src/shared/contracts";
import { artistIdentity, type FeaturedArtist } from "../../src/shared/featured-artists";

export type ArtistCandidate = Track & { primaryArtistId: number; albumId: number; titleShort: string };
export const sourceTrackSchema = z.object({
  id: z.string().regex(/^deezer-[1-9]\d*$/), providerId: z.string().regex(/^deezer-[1-9]\d*$/),
  title: z.string().min(1).max(300), artist: z.string().min(1).max(300), artworkUrl: z.string().url().nullable(),
  duration: z.number().min(16).max(30), genre: z.string().nullable(), releaseYear: z.number().int().nullable(),
  language: z.string().nullable(), playCount: z.literal(0), popularityScore: z.number().nonnegative().optional(),
  clipStartSec: z.number().nonnegative(), sourceUrl: z.string().url(), license: z.string().nullable(), available: z.boolean(),
});
export const artistCandidateSchema = sourceTrackSchema.extend({ primaryArtistId: z.number().int().positive(), albumId: z.number().int().positive(), titleShort: z.string().min(1) });
const unsupportedEdition = /karaoke|tribute|cover version|sped.?up|slowed|nightcore|backing track|made famous|originally performed|\bdemo\b|\blive\s+(?:at|from|in)\b|(?:\(|\[|[-–]\s*)live\b|\blive version\b/i;
export const recordingIdentity = (title: string) => artistIdentity(title.replace(/\s*[([](?:\d{4}\s*)?(?:remaster|radio edit|album version|single version|explicit|clean)\b[^)\]]*[)\]]/gi, "").replace(/\s*[-–]\s*(?:\d{4}\s*)?remaster.*$/i, ""));

export function selectArtistCandidates(input: readonly ArtistCandidate[], target: FeaturedArtist, artistId: number, limit = 50): ArtistCandidate[] {
  const names = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
  const seen = new Set<string>();
  return input.filter(row => row.available && row.duration >= 16 && row.primaryArtistId === artistId
    && names.has(artistIdentity(row.artist)) && /^deezer-[1-9]\d*$/.test(row.id) && row.providerId === row.id
    && row.sourceUrl === `https://www.deezer.com/track/${row.id.slice(7)}` && !unsupportedEdition.test(row.title))
    .sort((left, right) => (right.popularityScore || 0) - (left.popularityScore || 0) || left.id.localeCompare(right.id))
    .filter(row => {
      const identity = recordingIdentity(row.titleShort);
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    }).slice(0, limit);
}
