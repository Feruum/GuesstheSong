import { z } from "zod";
import { safeDeezerPreviewUrl } from "../../src/server/deezer";
import { FEATURED_ARTISTS, artistIdentity, type FeaturedArtist } from "../../src/shared/featured-artists";

const artistSchema = z.object({ id: z.number().int().positive(), name: z.string().min(1), nb_fan: z.number().nonnegative().default(0) });
const rawSongSchema = z.object({ id: z.number().int().positive(), title: z.string().min(1).max(300), title_short: z.string().optional(), duration: z.number().min(16), readable: z.literal(true), preview: z.string(), rank: z.number().min(100000), artist: z.object({ id: z.number().int().positive(), name: z.string().min(1) }), album: z.object({ id: z.number().int().positive() }) });
export const featuredSongSchema = z.object({ id: z.string().regex(/^deezer-\d+$/), providerId: z.number().int().positive(), title: z.string().min(1).max(300), artist: z.string().min(1), artistId: z.number().int().positive(), albumId: z.number().int().positive(), popularityScore: z.number().min(100000), sourceUrl: z.string().url() });
export type FeaturedSong = z.infer<typeof featuredSongSchema>;
const selectedArtistSchema = z.object({ name: z.string(), genre: z.string(), artistId: z.number().int().positive(), songs: z.array(featuredSongSchema) });
export const featuredManifestSchema = z.object({ generatedAt: z.string().optional(), complete: z.literal(true), productionActivated: z.literal(false), playbackScope: z.literal("private-local"), songsPerArtist: z.number().int().min(5).max(20), artists: z.array(selectedArtistSchema) });

export function resolveFeaturedArtist(target: FeaturedArtist, input: unknown): z.infer<typeof artistSchema> | null {
  if (!Array.isArray(input)) return null;
  const names = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
  return input.flatMap(row => { const result = artistSchema.safeParse(row); return result.success && result.data.nb_fan >= 1000 && names.has(artistIdentity(result.data.name)) ? [result.data] : []; })
    .sort((left, right) => right.nb_fan - left.nb_fan || left.id - right.id)[0] ?? null;
}

const unsupportedEdition = /karaoke|tribute|sped.?up|slowed|nightcore|backing track|made famous|originally performed|\bdemo\b|\blive\s+(?:at|from|in)\b|(?:\(|\[|[-–]\s*)live\b|\blive version\b/i;
const recordingIdentity = (title: string) => artistIdentity(title.replace(/\s*[([](?:\d{4}\s*)?(?:remaster|radio edit|album version|single version|explicit|clean)\b[^)\]]*[)\]]/gi, "").replace(/\s*[-–]\s*(?:\d{4}\s*)?remaster.*$/i, ""));

export function selectFeaturedSongs(input: unknown, artistId: number, limit: number): FeaturedSong[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input.flatMap(row => {
    const result = rawSongSchema.safeParse(row);
    return result.success && result.data.artist.id === artistId && safeDeezerPreviewUrl(result.data.preview) && !unsupportedEdition.test(result.data.title) ? [result.data] : [];
  }).sort((left, right) => right.rank - left.rank || left.id - right.id).filter(song => {
    const identity = recordingIdentity(song.title_short || song.title);
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  }).slice(0, limit).map(song => ({ id: `deezer-${song.id}`, providerId: song.id, title: song.title, artist: song.artist.name, artistId: song.artist.id, albumId: song.album.id, popularityScore: song.rank, sourceUrl: `https://www.deezer.com/track/${song.id}` }));
}

export function completeFeaturedManifest(input: unknown): z.infer<typeof featuredManifestSchema> {
  const manifest = featuredManifestSchema.parse(input);
  const expected = new Set(FEATURED_ARTISTS.map(row => artistIdentity(row.name)));
  const ids = new Set<number>(), names = new Set<string>();
  if (manifest.artists.length !== expected.size) throw new Error("A complete collection needs exactly 100 artists.");
  for (const artist of manifest.artists) {
    const name = artistIdentity(artist.name);
    if (!expected.has(name) || names.has(name) || ids.has(artist.artistId) || artist.songs.length !== manifest.songsPerArtist) throw new Error("The collection has a missing, duplicated or incomplete artist.");
    const songs = new Set<string>();
    const target = FEATURED_ARTISTS.find(row => artistIdentity(row.name) === name)!;
    const aliases = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
    for (const song of artist.songs) {
      if (song.artistId !== artist.artistId || !aliases.has(artistIdentity(song.artist)) || song.id !== `deezer-${song.providerId}` || song.sourceUrl !== `https://www.deezer.com/track/${song.providerId}` || songs.has(song.id)) throw new Error("A selected recording does not belong to its canonical artist.");
      songs.add(song.id);
    }
    names.add(name); ids.add(artist.artistId);
  }
  return manifest;
}
