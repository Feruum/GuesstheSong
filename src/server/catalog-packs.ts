import type { PackSummary, Track } from "../shared/contracts";
import { artistIdentity, featuredArtistNames } from "../shared/featured-artists";

export type CatalogPackKind = "mix" | "genre" | "decade";
export type CatalogPackId = "global-mix" | "electronic" | "hip-hop" | "indie" | "pop" | "rock" | "rnb" | "house" | "jazz" | "latin" | "metal" | "country" | "reggae" | "classical" | "1980s" | "1990s" | "2000s" | "2010s" | "2020s" | "popular" | "hits" | "hits-2010s" | "featured-hits";
export interface CatalogPackDefinition extends PackSummary { id: CatalogPackId; kind: CatalogPackKind }

export const DEFAULT_PACKS: CatalogPackDefinition[] = [
  { id: "global-mix", slug: "global-mix", name: "The global mix", description: "A little of everything from Audius. Find your next favorite.", genre: null, coverArt: "global", count: 0, kind: "mix" },
  { id: "electronic", slug: "electronic", name: "After hours", description: "Electronic, house, techno, and related genres tagged by Audius artists.", genre: "Electronic", coverArt: "electronic", count: 0, kind: "genre" },
  { id: "hip-hop", slug: "hip-hop", name: "Rap rotation", description: "Hip-hop and rap tracks tagged by Audius artists.", genre: "Hip-Hop/Rap", coverArt: "hip-hop", count: 0, kind: "genre" },
  { id: "indie", slug: "indie", name: "Off the beaten track", description: "Alternative, indie, folk, and acoustic tracks tagged by Audius artists.", genre: "Alternative", coverArt: "indie", count: 0, kind: "genre" },
  { id: "pop", slug: "pop", name: "Pop discoveries", description: "Tracks tagged Pop by Audius artists, in their own collection.", genre: "Pop", coverArt: "global", count: 0, kind: "genre" },
  { id: "rock", slug: "rock", name: "Rock discoveries", description: "Tracks tagged Rock by Audius artists, in their own collection.", genre: "Rock", coverArt: "indie", count: 0, kind: "genre" },
  { id: "2010s", slug: "2010s", name: "2010s discoveries", description: "Audius tracks with release years from 2010 to 2019. Popularity reflects current Audius play counts.", genre: null, coverArt: "global", count: 0, kind: "decade" },
  { id: "2020s", slug: "2020s", name: "2020s discoveries", description: "Audius tracks with release years from 2020 to 2029. Popularity reflects current Audius play counts.", genre: null, coverArt: "electronic", count: 0, kind: "decade" },
  { id: "popular", slug: "popular", name: "Popular on Audius", description: "The 200 most-played available tracks in this catalog, ranked by current Audius play counts.", genre: null, coverArt: "hip-hop", count: 0, kind: "mix" },
  { id: "hits", slug: "hits", name: "Hits & familiar artists", description: "Original recordings and official collaborations from well-known artists. Official Deezer previews.", genre: null, coverArt: "global", count: 0, kind: "mix" },
  { id: "hits-2010s", slug: "hits-2010s", name: "2010s · Familiar artists", description: "Songs by well-known artists with provider release dates from 2010 to 2019. Official Deezer previews.", genre: null, coverArt: "hip-hop", count: 0, kind: "decade" },
  { id: "rnb", slug: "rnb", name: "R&B & soul", description: "R&B and soul, using provider genre metadata.", genre: "R&B/Soul", coverArt: "hip-hop", count: 0, kind: "genre" },
  { id: "house", slug: "house", name: "House", description: "House, deep house, and tech house tagged by the music provider.", genre: "House", coverArt: "electronic", count: 0, kind: "genre" },
  { id: "jazz", slug: "jazz", name: "Jazz", description: "Jazz recordings, using provider genre metadata.", genre: "Jazz", coverArt: "indie", count: 0, kind: "genre" },
  { id: "latin", slug: "latin", name: "Latin", description: "Latin music, using provider genre metadata.", genre: "Latin", coverArt: "global", count: 0, kind: "genre" },
  { id: "metal", slug: "metal", name: "Metal", description: "Metal recordings, using provider genre metadata.", genre: "Metal", coverArt: "indie", count: 0, kind: "genre" },
  { id: "country", slug: "country", name: "Country", description: "Country recordings, using provider genre metadata.", genre: "Country", coverArt: "indie", count: 0, kind: "genre" },
  { id: "reggae", slug: "reggae", name: "Reggae", description: "Reggae recordings, using provider genre metadata.", genre: "Reggae", coverArt: "electronic", count: 0, kind: "genre" },
  { id: "classical", slug: "classical", name: "Classical", description: "Classical recordings, using provider genre metadata.", genre: "Classical", coverArt: "indie", count: 0, kind: "genre" },
  ...([1980, 1990, 2000] as const).map(year => ({ id: `${year}s` as CatalogPackId, slug: `${year}s`, name: `${year}s discoveries`, description: `Songs with provider release dates from ${year} to ${year + 9}. Reissues follow their edition’s release date.`, genre: null, coverArt: "global" as const, count: 0, kind: "decade" as const })),
  { id: "featured-hits", slug: "featured-hits", name: "100 hitmakers", description: "A curated selection of major pop, rap, rock, electronic and Latin artists. Official Deezer previews.", genre: null, coverArt: "global", count: 0, kind: "mix" },
];

export const AUTO_PACK_IDS = DEFAULT_PACKS.filter(pack => pack.id !== "global-mix").map(pack => pack.id);

export type CatalogPackTrack = Pick<Track, "id" | "genre" | "releaseYear" | "playCount" | "available"> & { artist?: string };
const genreTags: Partial<Record<CatalogPackId, ReadonlySet<string>>> = {
  pop: new Set(["Pop"]),
  rock: new Set(["Rock"]),
  indie: new Set(["Alternative", "Indie", "Folk", "Acoustic"]),
  "hip-hop": new Set(["Hip-Hop/Rap", "Hip-Hop", "Rap"]),
  rnb: new Set(["R&B/Soul", "R&B", "Soul"]),
  house: new Set(["House", "Deep House", "Tech House", "Progressive House"]),
  jazz: new Set(["Jazz"]), latin: new Set(["Latin", "Latin Music", "Salsa", "Reggaeton"]), metal: new Set(["Metal"]),
  country: new Set(["Country"]), reggae: new Set(["Reggae"]), classical: new Set(["Classical"]),
  electronic: new Set([
    "Electronic", "House", "Techno", "Ambient", "Trap", "Dance", "Dubstep", "Drum & Bass",
    "Tech House", "Deep House", "Trance", "Progressive House", "Electro", "Jungle", "Hardstyle",
    "Glitch Hop", "Future Bass", "Future House", "Tropical House", "Downtempo", "Jersey Club",
    "Vaporwave", "Moombahton", "Disco",
  ]),
};

export const GENRE_IMPORT_TARGETS = [
  { packId: "pop", genre: "Pop", query: "pop" },
  { packId: "rock", genre: "Rock", query: "rock" },
  { packId: "indie", genre: "Alternative", query: "alternative" },
  { packId: "hip-hop", genre: "Hip-Hop/Rap", query: "hip hop" },
] as const;

export function selectPackTracks<T extends CatalogPackTrack>(packId: string, input: readonly T[]): T[] {
  const tags = Object.hasOwn(genreTags, packId) ? genreTags[packId as CatalogPackId] : undefined;
  const startYear = /^(1980|1990|2000|2010|2020)s$/.test(packId) ? Number(packId.slice(0, 4)) : packId === "hits-2010s" ? 2010 : null;
  const matches = input.filter(track => {
    if (!track.available) return false;
    if (packId === "global-mix") return true;
    if (packId === "popular") return !track.id.startsWith("deezer-");
    if (packId === "hits") return track.id.startsWith("deezer-");
    if (packId === "featured-hits") return track.id.startsWith("deezer-") && !!track.artist && featuredArtistNames.has(artistIdentity(track.artist));
    if (packId === "hits-2010s" && !track.id.startsWith("deezer-")) return false;
    if (tags) return track.genre !== null && tags.has(track.genre);
    return startYear !== null && track.releaseYear !== null && Number.isInteger(track.releaseYear)
      && track.releaseYear >= startYear && track.releaseYear < startYear + 10;
  }).sort((left, right) => right.playCount - left.playCount || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const seen = new Set<string>();
  const unique = matches.filter(track => {
    if (seen.has(track.id)) return false;
    seen.add(track.id);
    return true;
  });
  return packId === "popular" ? unique.slice(0, 200) : unique;
}
export function countGenrePacks(input: readonly CatalogPackTrack[]) {
  return {
    pop: selectPackTracks("pop", input).length,
    rock: selectPackTracks("rock", input).length,
    indie: selectPackTracks("indie", input).length,
    "hip-hop": selectPackTracks("hip-hop", input).length,
  };
}
