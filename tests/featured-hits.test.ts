import { describe, expect, test } from "bun:test";
import { FEATURED_ARTISTS, DEFERRED_FEATURED_ARTISTS, artistIdentity } from "../src/shared/featured-artists";
import { resolveFeaturedArtist, selectFeaturedSongs, completeFeaturedManifest } from "../scripts/music-sources/featured-hits";
import { selectPackTracks } from "../src/server/catalog-packs";

const target = { name: "Kanye West", genre: "Hip-Hop/Rap", aliases: [] };
const record = { id: 123, title: "Heartless", title_short: "Heartless", duration: 211, readable: true, rank: 900000, preview: "https://cdnt-preview.dzcdn.net/api/song.mp3?hdnea=signed", artist: { id: 14, name: "Kanye West" }, album: { id: 42 } };

describe("recognizable hitmaker roster and selection", () => {
  test("contains exactly one hundred distinct major artists, including the requested rap artists", () => {
    expect(FEATURED_ARTISTS).toHaveLength(100);
    expect(new Set(FEATURED_ARTISTS.map(artist => artistIdentity(artist.name))).size).toBe(100);
    expect(FEATURED_ARTISTS.map(artist => artist.name)).toEqual(expect.arrayContaining(["Kanye West", "Drake", "The Weeknd", "Travis Scott", "Kendrick Lamar", "Rihanna", "BLACKPINK"]));
    expect(FEATURED_ARTISTS.filter(artist => DEFERRED_FEATURED_ARTISTS.some(deferred => deferred.name === artist.name))).toHaveLength(0);
  });
  test("resolves only exact canonical names or explicit aliases, rather than tribute accounts", () => {
    expect(resolveFeaturedArtist(target, [{ id: 1, name: "Kanye West Tribute", nb_fan: 9999999 }, { id: 14, name: "Kanye West", nb_fan: 15000000 }, { id: 15, name: "Kanye West", nb_fan: 20 }])?.id).toBe(14);
    expect(resolveFeaturedArtist(target, [{ id: 1, name: "Kanye Best", nb_fan: 9999999 }])).toBeNull();
    expect(resolveFeaturedArtist({ name: "P!nk", genre: "Pop", aliases: ["Pink"] }, [{ id: 2, name: "Pink", nb_fan: 1000000 }])?.id).toBe(2);
  });
  test("excludes another primary artist, unreadable songs and unofficial recordings", () => {
    const rows = [record, { ...record, id: 2, artist: { id: 99, name: "Kanye Tribute" } }, { ...record, id: 3, readable: false }, { ...record, id: 4, title: "Heartless (Karaoke)" }, { ...record, id: 5, title: "Heartless (Live at Wembley)" }, { ...record, id: 6, preview: "https://evil.test/song.mp3" }, { ...record, id: 7, rank: 1 }];
    expect(selectFeaturedSongs(rows, 14, 5).map(song => song.id)).toEqual(["deezer-123"]);
  });
  test("does not discard an original recording solely because Live is in its name", () => {
    expect(selectFeaturedSongs([{ ...record, title: "Live Your Life", title_short: "Live Your Life" }], 14, 5)).toHaveLength(1);
  });
  test("deduplicates reissues by recording title, takes highest rank and omits signed URLs", () => {
    const selected = selectFeaturedSongs([{ ...record, id: 1, rank: 700000 }, { ...record, id: 2, title: "Heartless (2019 Remaster)", rank: 900000 }, { ...record, id: 3, title: "Stronger", title_short: "Stronger", rank: 800000 }], 14, 5);
    expect(selected.map(song => song.id)).toEqual(["deezer-2", "deezer-3"]);
    expect(JSON.stringify(selected)).not.toContain("hdnea");
    expect(selected[0].sourceUrl).toBe("https://www.deezer.com/track/2");
  });
  test("does not accept a partial artist list as a complete playable collection", () => {
    expect(() => completeFeaturedManifest({ artists: [], songsPerArtist: 5 })).toThrow();
    expect(() => completeFeaturedManifest({ artists: [{ name: "Kanye West", artistId: 14, songs: selectFeaturedSongs([record], 14, 5) }], songsPerArtist: 5 })).toThrow();
  });
  const collection = () => ({ complete: true, productionActivated: false, playbackScope: "private-local", songsPerArtist: 5, artists: FEATURED_ARTISTS.map((artist, index) => ({
    name: artist.name, genre: artist.genre, artistId: index + 1,
    songs: Array.from({ length: 5 }, (_, songIndex) => {
      const id = index * 5 + songIndex + 1;
      return { id: `deezer-${id}`, providerId: id, title: `Recording ${id}`, artist: artist.name, artistId: index + 1, albumId: id, popularityScore: 800000, sourceUrl: `https://www.deezer.com/track/${id}` };
    }),
  })) });
  test("accepts all 100 canonical artists with five distinct recordings each", () => {
    expect(completeFeaturedManifest(collection()).artists.reduce((count, artist) => count + artist.songs.length, 0)).toBe(500);
  });
  test("accepts a metadata-only hosted verification list without activating other installations", () => {
    const manifest = completeFeaturedManifest({ ...collection(), playbackScope: "metadata-only" });
    expect(manifest.artists).toHaveLength(100);
    expect(manifest.productionActivated).toBe(false);
  });
  test("the published shortlist is complete reusable metadata with distinct official recordings", async () => {
    const input = await Bun.file(new URL("../data/featured-hitmakers.json", import.meta.url)).json();
    const manifest = completeFeaturedManifest(input);
    const songs = manifest.artists.flatMap(artist => artist.songs);
    expect(manifest.playbackScope).toBe("metadata-only");
    expect(manifest.productionActivated).toBe(false);
    expect(songs).toHaveLength(500);
    expect(new Set(songs.map(song => song.id)).size).toBe(500);
    expect(JSON.stringify(input)).not.toMatch(/cdnt-preview|hdnea|DATABASE_URL|REDIS_URL/);
  });
  test("rejects tampered artist credits, identities, track IDs and source links", () => {
    for (const change of [
      (input: ReturnType<typeof collection>) => { input.artists[0].songs[0].artist = "Tribute Band"; },
      (input: ReturnType<typeof collection>) => { input.artists[0].songs[0].artistId = 999; },
      (input: ReturnType<typeof collection>) => { input.artists[0].songs[0].providerId = 999; },
      (input: ReturnType<typeof collection>) => { input.artists[0].songs[0].sourceUrl = "https://evil.test/track/1"; },
      (input: ReturnType<typeof collection>) => { input.artists[0].songs[1] = { ...input.artists[0].songs[0] }; },
      (input: ReturnType<typeof collection>) => { input.artists[1].artistId = input.artists[0].artistId; },
      (input: ReturnType<typeof collection>) => { input.artists[1].name = input.artists[0].name; },
    ]) {
      const input = collection(); change(input);
      expect(() => completeFeaturedManifest(input)).toThrow();
    }
  });
  test("rejects manifests marked incomplete or enabled for public playback", () => {
    expect(() => completeFeaturedManifest({ ...collection(), complete: false })).toThrow();
    expect(() => completeFeaturedManifest({ ...collection(), productionActivated: true })).toThrow();
    expect(() => completeFeaturedManifest({ ...collection(), playbackScope: "public" })).toThrow();
  });
});

describe("famous-artist pack", () => {
  test("contains only active private official previews of selected artist identities", () => {
    const rows = [
      { id: "deezer-1", artist: "Kanye West", available: true, genre: "Hip-Hop/Rap", releaseYear: 2007, playCount: 0 },
      { id: "audius-1", artist: "Kanye West", available: true, genre: "Hip-Hop/Rap", releaseYear: 2007, playCount: 100 },
      { id: "deezer-2", artist: "Unknown Artist", available: true, genre: "Pop", releaseYear: 2015, playCount: 0 },
      { id: "deezer-3", artist: "Rihanna", available: false, genre: "Pop", releaseYear: 2007, playCount: 0 },
      { id: "deezer-4", artist: "Pink", available: true, genre: "Pop", releaseYear: 2010, playCount: 0 },
    ];
    expect(selectPackTracks("featured-hits", rows).map(song => song.id)).toEqual(["deezer-1", "deezer-4"]);
  });
});
