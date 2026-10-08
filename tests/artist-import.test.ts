import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { selectArtistCandidates, type ArtistCandidate } from "../scripts/music-sources/artist-packs";
import { artistIdentity, featuredArtistNames, type FeaturedArtist } from "../src/shared/featured-artists";
import { EXPANDED_ARTISTS } from "../src/shared/expanded-artists";

const target: FeaturedArtist = { name: "Fugazi", genre: "Rock" };
const candidate = (number: number, title: string, changes: Partial<ArtistCandidate> = {}): ArtistCandidate => ({
  id: `deezer-${number}`, providerId: `deezer-${number}`, title, titleShort: title, artist: "Fugazi",
  primaryArtistId: 2873, albumId: 123, duration: 30, available: true, artworkUrl: null,
  genre: null, releaseYear: null, language: null, playCount: 0, popularityScore: 500,
  clipStartSec: 0, sourceUrl: `https://www.deezer.com/track/${number}`, license: "Official Deezer preview", ...changes,
});

test("artist imports include lower-ranked originals but reject unrelated or unavailable recordings", () => {
  const selected = selectArtistCandidates([
    candidate(1, "Waiting Room", { popularityScore: 500000 }), candidate(2, "Repeater", { popularityScore: 900 }),
    candidate(3, "Wrong ID", { primaryArtistId: 555 }), candidate(4, "Tribute", { artist: "Fugazi Tribute" }),
    candidate(5, "Unavailable", { available: false }), candidate(6, "Too short", { duration: 10 }),
    candidate(7, "Waiting Room (Karaoke)"), candidate(8, "Waiting Room (Live at Brixton)"),
    candidate(9, "Short URL", { sourceUrl: "https://example.com/audio.mp3" }),
  ], target, 2873);
  expect(selected.map(row => row.id)).toEqual(["deezer-1", "deezer-2"]);
  expect(selected[1].genre).toBeNull();
  expect(selected[1].language).toBeNull();
});

test("artist imports deduplicate editions, preserve distinct songs and accept explicit aliases", () => {
  const selected = selectArtistCandidates([
    candidate(1, "Repeater (2020 Remaster)", { titleShort: "Repeater", popularityScore: 900 }),
    candidate(2, "Repeater", { popularityScore: 100 }), candidate(3, "Waiting Room", { popularityScore: 500 }),
    candidate(4, "Smallpox Champion", { popularityScore: 50 }),
  ], target, 2873, 2);
  expect(selected.map(row => row.id)).toEqual(["deezer-1", "deezer-3"]);
  expect(selectArtistCandidates([candidate(5, "Судно", { artist: "Молчат Дома" })],
    { name: "Molchat Doma", genre: "Alternative", aliases: ["Молчат Дома"] }, 2873)).toHaveLength(1);
});

test("published expansion contains unique verified originals without audio URLs or changing the Daily roster", async () => {
  const raw = await readFile(new URL("../data/expanded-artists.json", import.meta.url), "utf8");
  const manifest = JSON.parse(raw) as { playbackScope: string; verifiedOrigin: string; verifiedClipSeconds: number; artists: {
    name: string; artistId: number; songs: { id: string; artist: string; sourceUrl: string; verifiedAt: string }[];
  }[] };
  expect(manifest.playbackScope).toBe("metadata-only");
  expect(manifest.verifiedOrigin).toBe("https://guessthesong-rust.vercel.app");
  expect(manifest.verifiedClipSeconds).toBe(1);
  expect(manifest.artists.map(row => row.name)).toEqual(EXPANDED_ARTISTS.map(row => row.name));
  const ids = new Set<string>();
  for (const artist of manifest.artists) {
    const target = EXPANDED_ARTISTS.find(row => row.name === artist.name)!;
    const names = new Set([target.name, ...target.aliases ?? []].map(artistIdentity));
    expect(artist.artistId).toBeGreaterThan(0);
    expect(artist.songs).toHaveLength(10);
    expect(featuredArtistNames.has(artistIdentity(artist.name))).toBe(false);
    for (const song of artist.songs) {
      expect(names.has(artistIdentity(song.artist))).toBe(true);
      expect(song.id).toMatch(/^deezer-[1-9]\d*$/);
      expect(song.sourceUrl).toBe(`https://www.deezer.com/track/${song.id.slice(7)}`);
      expect(Number.isFinite(Date.parse(song.verifiedAt))).toBe(true);
      expect(ids.has(song.id)).toBe(false);
      ids.add(song.id);
    }
  }
  expect(ids.size).toBe(260);
  expect(raw).not.toMatch(/dzcdn\.net|\.mp3|gts_admin|gts_guest|"password"/);
});
