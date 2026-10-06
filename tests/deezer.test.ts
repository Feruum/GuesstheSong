import { describe, expect, spyOn, test } from "bun:test";
import { deezerPreviewsEnabled, getDeezerTrack, normalizeDeezerTrack, privatePreviewsEnabled, publicPreviewsEnabled, safeDeezerPreviewUrl } from "../src/server/deezer";
import { musicSource } from "../src/shared/music-source";
import { boundedMusicClip } from "../src/server/audio-clips";

const raw = {
  id: 12345, title: "A familiar song", duration: 210, readable: true, rank: 876000,
  preview: "https://cdnt-preview.dzcdn.net/api/1/song.mp3?hdnea=signature",
  link: "https://www.deezer.com/track/12345", artist: { id: 42, name: "Original artist" },
  album: { id: 99, cover_medium: "https://cdn-images.dzcdn.net/images/cover/example/250x250.jpg" },
};

describe("official Deezer previews", () => {
  test("a permanently removed provider recording returns null so refresh can disable it", async () => {
    const previous = { APP_URL: process.env.APP_URL, DEEZER_PRIVATE_PREVIEWS: process.env.DEEZER_PRIVATE_PREVIEWS };
    process.env.APP_URL = "http://127.0.0.1:3000"; process.env.DEEZER_PRIVATE_PREVIEWS = "true";
    const request = spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: { type: "DataException", code: 800, message: "no data" } }));
    try { expect(await getDeezerTrack("deezer-12345")).toBeNull(); }
    finally {
      request.mockRestore();
      if (previous.APP_URL === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous.APP_URL;
      if (previous.DEEZER_PRIVATE_PREVIEWS === undefined) delete process.env.DEEZER_PRIVATE_PREVIEWS; else process.env.DEEZER_PRIVATE_PREVIEWS = previous.DEEZER_PRIVATE_PREVIEWS;
    }
  });
  test("uses the preview duration, separate popularity, actual album metadata, and no fabricated plays", () => {
    const track = normalizeDeezerTrack(raw, { release_date: "2015-03-02", genres: { data: [{ name: "Pop" }] } });
    expect(track).toMatchObject({ id: "deezer-12345", providerId: "deezer-12345", duration: 30, genre: "Pop", releaseYear: 2015, playCount: 0, popularityScore: 876000, available: true });
    expect(musicSource(track!)).toBe("Deezer");
    expect(musicSource({ id: "audius-hash" })).toBe("Audius");
  });

  test("maps provider genres and never infers a decade from the title", () => {
    expect(normalizeDeezerTrack(raw, { genres: { data: [{ name: "Rap/Hip Hop" }] } })?.genre).toBe("Hip-Hop/Rap");
    expect(normalizeDeezerTrack(raw, { genres: { data: [{ name: "Latin Music" }] } })?.genre).toBe("Latin");
    expect(normalizeDeezerTrack({ ...raw, title: "2010s Pop Hits" })?.releaseYear).toBeNull();
    expect(normalizeDeezerTrack(raw, { release_date: "invalid" })?.releaseYear).toBeNull();
  });

  test("excludes missing previews, unreadable tracks, invalid IDs, and short audio", () => {
    for (const change of [{ preview: "" }, { readable: false }, { id: -1 }, { duration: 10 }, { preview: "https://example.com/song.mp3" }]) {
      expect(normalizeDeezerTrack({ ...raw, ...change })).toBeNull();
    }
  });

  test("only accepts HTTPS on the preview CDN without credentials or alternate ports", () => {
    expect(safeDeezerPreviewUrl(raw.preview)).toBe(raw.preview);
    for (const url of ["http://cdnt-preview.dzcdn.net/song.mp3", "https://cdnt-preview.dzcdn.net.evil.test/x", "https://user:pass@cdnt-preview.dzcdn.net/x", "https://cdnt-preview.dzcdn.net:444/x", "https://127.0.0.1/x"]) {
      expect(safeDeezerPreviewUrl(url)).toBeNull();
    }
  });

  test("requires an explicit opt-in and a loopback app origin", () => {
    expect(privatePreviewsEnabled({ DEEZER_PRIVATE_PREVIEWS: "true", APP_URL: "http://127.0.0.1:3000" })).toBe(true);
    expect(privatePreviewsEnabled({ DEEZER_PRIVATE_PREVIEWS: "true", APP_URL: "http://localhost:3000" })).toBe(true);
    expect(privatePreviewsEnabled({ DEEZER_PRIVATE_PREVIEWS: "true", APP_URL: "https://game.example.com" })).toBe(false);
    expect(privatePreviewsEnabled({ APP_URL: "http://localhost:3000" })).toBe(false);
    expect(privatePreviewsEnabled({ DEEZER_PRIVATE_PREVIEWS: "true", APP_URL: "http://localhost.evil.test:3000" })).toBe(false);
  });

  test("enables production only for explicit approval bound to the exact HTTPS app origin", () => {
    const env = { APP_URL: "https://music.example.com", DEEZER_PUBLIC_PREVIEWS_APPROVED: "true", DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com" };
    expect(publicPreviewsEnabled(env)).toBe(true);
    expect(deezerPreviewsEnabled(env)).toBe(true);
    expect(privatePreviewsEnabled(env)).toBe(false);
    expect(deezerPreviewsEnabled({ APP_URL: "http://localhost:3000", DEEZER_PRIVATE_PREVIEWS: "true" })).toBe(true);
    for (const change of [
      { DEEZER_PUBLIC_PREVIEWS_APPROVED: undefined }, { DEEZER_PUBLIC_PREVIEWS_APPROVED: "false" },
      { DEEZER_PUBLIC_PREVIEWS_ORIGIN: undefined }, { APP_URL: "https://preview.example.com" },
      { APP_URL: "https://music.example.com.evil.test" }, { APP_URL: "http://music.example.com" },
      { APP_URL: "https://music.example.com/path" }, { APP_URL: "https://user:pass@music.example.com" },
      { DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com/path" },
      { DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com?test=true" },
      { DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com#test" },
      { DEEZER_PUBLIC_PREVIEWS_ORIGIN: "invalid" },
    ]) expect(deezerPreviewsEnabled({ ...env, ...change })).toBe(false);
    expect(publicPreviewsEnabled({ ...env, APP_URL: "https://localhost", DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://localhost" })).toBe(false);
  });

  test("approved public imports use fresh readable provider metadata and neutral source attribution", async () => {
    const keys = ["APP_URL", "DEEZER_PRIVATE_PREVIEWS", "DEEZER_PUBLIC_PREVIEWS_APPROVED", "DEEZER_PUBLIC_PREVIEWS_ORIGIN"] as const;
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    Object.assign(process.env, { APP_URL: "https://music.example.com", DEEZER_PRIVATE_PREVIEWS: "false", DEEZER_PUBLIC_PREVIEWS_APPROVED: "true", DEEZER_PUBLIC_PREVIEWS_ORIGIN: "https://music.example.com" });
    const request = spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(raw)).mockResolvedValueOnce(Response.json({ genres: { data: [{ name: "Pop" }] } }));
    try {
      const track = await getDeezerTrack("deezer-12345");
      expect(track).toMatchObject({ id: "deezer-12345", artist: "Original artist", genre: "Pop", license: "Official Deezer preview" });
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls.map(([input]) => String(input))).toEqual(["https://api.deezer.com/track/12345", "https://api.deezer.com/album/99"]);
      process.env.DEEZER_PUBLIC_PREVIEWS_APPROVED = "false";
      expect(await getDeezerTrack("deezer-12345")).toBeNull();
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      request.mockRestore();
      for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
    }
  });

  test("rejects private audio before consulting an existing cache in a public configuration", async () => {
    const previous = process.env.APP_URL;
    try {
      process.env.APP_URL = "https://music.example.com";
      await expect(boundedMusicClip("deezer-12345", 0, 1)).rejects.toThrow("disabled for this application");
    } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
  });
});
