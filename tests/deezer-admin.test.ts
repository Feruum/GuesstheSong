import { describe, expect, spyOn, test } from "bun:test";
import * as provider from "../src/server/deezer";
import * as audio from "../src/server/audio-clips";
import { checkDeezerPreviews, searchDeezerPreviews } from "../src/server/deezer-admin";
import type { Track } from "../src/shared/contracts";

const enabled = { APP_URL: "https://music.example.com", DEEZER_PUBLIC_PREVIEWS_APPROVED: "true", DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com" };
const track: Track = { id: "deezer-123", providerId: "deezer-123", title: "Original recording", artist: "Artist", artworkUrl: null, duration: 30, genre: "Pop", releaseYear: 2010, language: null, playCount: 0, popularityScore: 800000, clipStartSec: 0, sourceUrl: "https://www.deezer.com/track/123", license: "Official Deezer preview", available: true };

describe("deployment preview verification", () => {
  test("pages provider searches without accepting unbounded offsets", async () => {
    const lookup = spyOn(provider, "deezerGet").mockResolvedValue({ data: [] });
    try {
      expect(await searchDeezerPreviews("Metallica", 50)).toEqual([]);
      expect(lookup).toHaveBeenCalledWith("search", { q: "Metallica", limit: 50, index: 50 });
      await expect(searchDeezerPreviews("Metallica", 2001)).rejects.toThrow();
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally { lookup.mockRestore(); }
  });
  test("search exposes canonical artist IDs and metadata without CDN URLs or unreadable recordings", async () => {
    const raw = { id: 123, title: "Original recording", title_short: "Original recording", duration: 200, readable: true, preview: "https://cdnt-preview.dzcdn.net/api/song.mp3?signature=private", rank: 800000, artist: { id: 42, name: "Artist" }, album: { id: 99 } };
    const lookup = spyOn(provider, "deezerGet").mockResolvedValue({ data: [raw, { ...raw, id: 124, readable: false }, { ...raw, id: 125, preview: "https://evil.example/song.mp3" }] });
    try {
      const rows = await searchDeezerPreviews("Artist");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "deezer-123", primaryArtistId: 42, albumId: 99, titleShort: "Original recording" });
      expect(JSON.stringify(rows)).not.toContain("signature");
      expect(JSON.stringify(rows)).not.toContain("cdnt-preview");
      expect(lookup).toHaveBeenCalledWith("search", { q: "Artist", limit: 50 });
    } finally { lookup.mockRestore(); }
  });
  test("disabled applications never contact the provider", async () => {
    const lookup = spyOn(provider, "getDeezerTrack");
    try { await expect(checkDeezerPreviews(["deezer-123"], {})).rejects.toThrow("disabled"); expect(lookup).not.toHaveBeenCalled(); }
    finally { lookup.mockRestore(); }
  });
  test("requires fresh playable metadata and bounded audio before approving a recording", async () => {
    const lookup = spyOn(provider, "getDeezerTrack").mockResolvedValue(track);
    const clip = spyOn(audio, "boundedMusicClip").mockResolvedValue(Buffer.from([255, 251]));
    try {
      expect(await checkDeezerPreviews(["deezer-123", "deezer-123"], enabled)).toEqual([{ id: "deezer-123", playable: true, track }]);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(clip).toHaveBeenCalledWith("deezer-123", 0, 1);
    } finally { lookup.mockRestore(); clip.mockRestore(); }
  });
  test("unavailable metadata and failed audio never become imported playable records", async () => {
    const lookup = spyOn(provider, "getDeezerTrack").mockResolvedValueOnce(null).mockResolvedValueOnce(track);
    const clip = spyOn(audio, "boundedMusicClip").mockRejectedValue(new Error("provider request failed"));
    try {
      const rows = await checkDeezerPreviews(["deezer-1", "deezer-123"], enabled);
      expect(rows.every(row => !row.playable && !row.track)).toBe(true);
      expect(clip).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(rows)).not.toContain("provider request failed");
    } finally { lookup.mockRestore(); clip.mockRestore(); }
  });
});
