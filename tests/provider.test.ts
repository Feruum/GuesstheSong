import { describe, expect, test } from "bun:test";
import { normalizeAudiusTrack, validatePlaylistUrl } from "../src/server/audius";

const song = { id: "abc123", title: "A real track", duration: 200, genre: "Electronic", play_count: 4200, is_streamable: true, is_available: true, is_stream_gated: false, is_unlisted: false, license: null, permalink: "/artist/a-real-track", release_date: "2024-03-01T00:00:00Z", user: { name: "An artist" }, artwork: { "480x480": "https://creator.audius.co/cover.jpg" } };
describe("Audius catalog eligibility", () => {
  test("supports live artwork mirrors and default API-accessible rights", () => {
    const track = normalizeAudiusTrack({ ...song, license: "All rights reserved", artwork: { ...song.artwork, mirrors: ["https://validator.example"] } });
    expect(track?.artworkUrl).toBe(song.artwork["480x480"]);
    expect(track?.license).toBe("All rights reserved");
  });
  test("normalizes available music and its actual release date", () => {
    const track = normalizeAudiusTrack(song);
    expect(track?.title).toBe("A real track");
    expect(track?.artist).toBe("An artist");
    expect(track?.releaseYear).toBe(2024);
    expect(track?.playCount).toBe(4200);
    expect(track?.sourceUrl).toBe("https://audius.co/artist/a-real-track");
  });
  test("excludes unavailable, gated, unlisted, and oversized mixes", () => {
    for (const change of [{ is_available: false }, { is_stream_gated: true }, { is_unlisted: true }, { duration: 3500 }, { duration: 10 }, { id: "../../private" }]) {
      expect(normalizeAudiusTrack({ ...song, ...change })).toBeNull();
    }
  });
  test("does not infer release year from the upload date or invent language", () => {
    const track = normalizeAudiusTrack({ ...song, release_date: null, created_at: "2025-01-01" });
    expect(track?.releaseYear).toBeNull();
    expect(track?.language).toBeNull();
  });
  test("excludes alternative licenses requiring unverified permission", () => {
    expect(normalizeAudiusTrack({ ...song, license: "https://example.com/private-license" })).toBeNull();
  });
  test("only resolves public Audius URLs", () => {
    expect(validatePlaylistUrl("https://audius.co/artist/playlist/a-good-playlist")).toBe(true);
    expect(validatePlaylistUrl("http://127.0.0.1:8000/private")).toBe(false);
    expect(validatePlaylistUrl("https://audius.co.attacker.example/playlist/1")).toBe(false);
  });
});
