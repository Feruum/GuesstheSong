import { describe, expect, test } from "bun:test";
import { chooseLicense, parseDuration, uniqueAudio, probeAudio, fetchJson } from "../scripts/music-sources/shared";
import { parseIncompetechGenres, normalizeIncompetech } from "../scripts/music-sources/incompetech";
import { normalizeCommons } from "../scripts/music-sources/commons";
import { normalizeCCMixter } from "../scripts/music-sources/ccmixter";
import { normalizeOpenverse } from "../scripts/music-sources/openverse";
import { discoverMusic, discoveryOutputPath, parseDiscoveryArgs } from "../scripts/music-sources/discovery";
import { MusicSourceError, type MusicSource } from "../scripts/music-sources/shared";
import { join } from "node:path";

const piece = { title: "Sneaky Snitch", filename: "Sneaky Snitch.mp3", length: "00:02:17", genre: "22", isrc: "USUAN1100772", uploaded: "2010-11-25" };
const commons = {
  pageid: 4226066, title: "File:Moonlight.ogg", videoinfo: [{
    duration: 473.26, mime: "application/ogg", url: "https://upload.wikimedia.org/wikipedia/commons/f/f0/Moonlight.ogg",
    descriptionurl: "https://commons.wikimedia.org/wiki/File:Moonlight.ogg",
    derivatives: [{ src: "https://upload.wikimedia.org/wikipedia/commons/transcoded/f/f0/Moonlight.ogg/Moonlight.ogg.mp3", type: "audio/mpeg" }],
    extmetadata: {
      ObjectName: { value: "Moonlight" }, Artist: { value: "<b>Ludwig van Beethoven</b>" },
      Credit: { value: "<p>Recording by Juan Felipe Arjona</p>" },
      LicenseUrl: { value: "https://creativecommons.org/licenses/by/2.5" },
      DateTime: { value: "2008-06-16 01:27:08" }, DateTimeOriginal: { value: "2006-02-02" },
    },
  }],
};

describe("music discovery license policy", () => {
  test("accepts recognized permissive licenses and keeps their exact version", () => {
    expect(chooseLicense("http://creativecommons.org/licenses/by-sa/3.0/", false)?.code).toBe("by-sa");
    expect(chooseLicense("https://creativecommons.org/publicdomain/zero/1.0/")?.code).toBe("cc0");
    expect(chooseLicense("https://creativecommons.org/licenses/by/2.5")?.version).toBe("2.5");
  });
  test("NC is opt-in, ND is never automatically accepted", () => {
    expect(chooseLicense("https://creativecommons.org/licenses/by-nc/4.0/")).toBeNull();
    expect(chooseLicense("https://creativecommons.org/licenses/by-nc/4.0/", true)?.commercial).toBe(false);
    expect(chooseLicense("https://creativecommons.org/licenses/by-nc-nd/4.0/", true)).toBeNull();
    expect(chooseLicense("https://creativecommons.org/licenses/by-nd/4.0/")).toBeNull();
  });
  test("does not accept a license lookalike, unknown version, or ambiguous combination", () => {
    for (const url of ["https://creativecommons.org.evil.test/licenses/by/4.0/", "https://creativecommons.org/licenses/by/99.0/", "All rights reserved", "https://creativecommons.org/licenses/by/4.0/ OR https://example.com/license"]) {
      expect(chooseLicense(url)).toBeNull();
    }
  });
});

describe("publisher and API parsers", () => {
  test("parses only the static genre JSON and never executes page JavaScript", () => {
    const html = '<script>const genres = [{"id":22,"genre":"Soundtrack"}]; globalThis.bad = true;</script>';
    expect(parseIncompetechGenres(html)).toEqual({ "22": "Soundtrack" });
    expect(parseIncompetechGenres("const genres = [runCode()];")).toEqual({});
  });
  test("keeps provider dates separate from original release years and escapes filenames", () => {
    const track = normalizeIncompetech(piece, { "22": "Soundtrack" });
    expect(track?.title).toBe("Sneaky Snitch");
    expect(track?.durationSec).toBe(137);
    expect(track?.audioUrl).toEndWith("Sneaky%20Snitch.mp3");
    expect(track?.publishedAt).toBe("2010-11-25");
    expect(track?.releaseYear).toBeNull();
    expect(track?.genreTags).toEqual(["Soundtrack"]);
    expect(track?.attribution).toContain("Kevin MacLeod");
  });
  test("rejects traversal, missing metadata and clips shorter than the last game stage", () => {
    expect(normalizeIncompetech({ ...piece, filename: "../secret.mp3" }, {})).toBeNull();
    expect(normalizeIncompetech({ ...piece, filename: "%2e%2e%2fsecret.mp3" }, {})).toBeNull();
    expect(normalizeIncompetech({ ...piece, length: "00:00:05" }, {})).toBeNull();
    expect(normalizeIncompetech({ ...piece, title: "" }, {})).toBeNull();
  });
  test("Commons uses the supplied MP3 derivative and retains performer credit", () => {
    const track = normalizeCommons(commons);
    expect(track?.audioMime).toBe("audio/mpeg");
    expect(track?.audioUrl).toEndWith("Moonlight.ogg.mp3");
    expect(track?.attribution).toContain("Juan Felipe Arjona");
    expect(track?.artist).toBe("Ludwig van Beethoven");
    expect(track?.releaseYear).toBeNull();
  });
  test("Commons rejects missing licenses, explicit additional restrictions, and foreign asset hosts", () => {
    const source = commons.videoinfo[0];
    expect(normalizeCommons({ ...commons, videoinfo: [{ ...source, extmetadata: {} }] })).toBeNull();
    expect(normalizeCommons({ ...commons, videoinfo: [{ ...source, extmetadata: { ...source.extmetadata, Restrictions: { value: "No web games" } } }] })).toBeNull();
    expect(normalizeCommons({ ...commons, videoinfo: [{ ...source, derivatives: [], url: "https://localhost/song.mp3" }] })).toBeNull();
  });
  test("ccMixter preserves collaborators, takes a complete MP3 and parses its duration", () => {
    const track = normalizeCCMixter({
      upload_id: 16626, upload_name: "I dunno", user_real_name: "grapes", file_page_url: "https://ccmixter.org/files/grapes/16626",
      license_url: "https://creativecommons.org/licenses/by/3.0/", upload_extra: { featuring: "J Lang, Morusque", usertags: "hip_hop,instrumental" },
      files: [{ download_url: "https://ccmixter.org/content/grapes/grapes_-_I_dunno.mp3", file_is_remote: 0, file_format_info: { mime_type: "audio/mpeg", ps: "3:01" } }],
    });
    expect(track?.durationSec).toBe(181);
    expect(track?.genreTags).toContain("Hip-Hop/Rap");
    expect(track?.attribution).toContain("J Lang, Morusque");
  });
  test("ccMixter does not turn a paid-only or remote asset into a free candidate", () => {
    expect(normalizeCCMixter({ upload_id: 1, license_url: "https://tunetrack.net/license/paid", files: [] })).toBeNull();
  });
  test("Openverse milliseconds are converted and publication dates are not invented", () => {
    const track = normalizeOpenverse({
      id: "fe757df4-a4bb-4795-b78d-a6fc5b0888ac", title: "Monkeys Spinning Monkeys", creator: "Kevin MacLeod", duration: 125074,
      license: "by", license_version: "3.0", url: "https://upload.wikimedia.org/wikipedia/commons/f/fe/monkeys.mp3",
      foreign_landing_url: "https://commons.wikimedia.org/w/index.php?curid=88730740", filetype: "mp3",
    });
    expect(track?.durationSec).toBeCloseTo(125.074);
    expect(track?.releaseYear).toBeNull();
    expect(track?.publishedAt).toBeNull();
  });
});

describe("safe bounded provider access", () => {
  test("duration parser handles hours and rejects malformed/negative inputs", () => {
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("3:19")).toBe(199);
    expect(parseDuration("00:99:00")).toBeNull();
    expect(parseDuration("-1:30")).toBeNull();
  });
  test("deduplicates the same Wikimedia audio even when tracking parameters differ", () => {
    const track = normalizeCommons(commons)!;
    expect(uniqueAudio([
      { ...track, audioUrl: `${track.audioUrl}?utm_source=one` },
      { ...track, id: "another", audioUrl: `${track.audioUrl}?utm_source=two#player` },
    ])).toHaveLength(1);
  });
  test("unknown hosts never reach the network, including redirects", async () => {
    let calls = 0;
    const fake = async () => { calls++; return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } }); };
    await expect(fetchJson("https://ccmixter.org.evil.test/api/query", fake)).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(fetchJson("https://ccmixter.org/api/query?f=json", fake)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  test("metadata transfers have a strict size limit and tolerate JSON served as text/plain", async () => {
    await expect(fetchJson("https://ccmixter.org/api/query", async () => new Response('[{"ok":true}]', { headers: { "content-type": "text/plain" } }))).resolves.toEqual([{ ok: true }]);
    await expect(fetchJson("https://ccmixter.org/api/query", async () => new Response("x".repeat(2_100_000)))).rejects.toThrow("large");
  });
  test("rate-limit responses retain Retry-After without retrying the API", async () => {
    let calls = 0;
    const failure = await fetchJson("https://ccmixter.org/api/query", async () => {
      calls++; return new Response(null, { status: 429, headers: { "retry-after": "60" } });
    }).catch(error => error);
    expect(failure).toBeInstanceOf(MusicSourceError);
    if (!(failure instanceof MusicSourceError)) throw new Error("Expected a rate-limit error.");
    expect(failure.retryAfter).toBe("60");
    expect(calls).toBe(1);
  });
  test("HTML errors are not playable audio", async () => {
    const result = await probeAudio("https://incompetech.com/music/royalty-free/mp3-royaltyfree/song.mp3", async () => new Response("not music", { headers: { "content-type": "text/html" } }));
    expect(result.ok).toBe(false);
  });
  test("a server ignoring Range is cancelled after a bounded sample", async () => {
    let cancelled = false;
    const data = new Uint8Array(65_536); data.set([0x49, 0x44, 0x33]);
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(data); }, cancel() { cancelled = true; } });
    const result = await probeAudio("https://incompetech.com/music/royalty-free/mp3-royaltyfree/song.mp3", async (_input, init) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=0-65535");
      return new Response(stream, { status: 200, headers: { "content-type": "audio/mpeg" } });
    });
    expect(result.ok).toBe(true);
    expect(result.bytesRead).toBeLessThanOrEqual(65_536);
    expect(cancelled).toBe(true);
  });
});

describe("discovery command", () => {
  test("validates source, search, limits and flags before making requests", () => {
    expect(parseDiscoveryArgs(["--source", "ccmixter", "--query", "hip_hop", "--limit", "5", "--verify-audio"])).toMatchObject({ source: "ccmixter", query: "hip_hop", limit: 5, verifyAudio: true, nonCommercial: false });
    expect(parseDiscoveryArgs(["--source", "incompetech"])).toMatchObject({ limit: 20, query: "" });
    expect(parseDiscoveryArgs(["--help"]).help).toBe(true);
    for (const args of [["--source", "spotify"], ["--query", "song", "--limit", "0"], ["--query", "song", "--limit", "51"], ["--query", "song", "--limit", "1.5"], ["--source", "openverse"], ["--unknown"]]) {
      expect(() => parseDiscoveryArgs(args)).toThrow();
    }
  });
  test("exports only to a JSON artifact inside the local .data directory", () => {
    const root = process.cwd();
    expect(discoveryOutputPath(".data/music-discovery/tracks.json", root)).toBe(join(root, ".data", "music-discovery", "tracks.json"));
    for (const file of ["package.json", ".data/../package.json", ".data/tracks.ts", "../outside.json"]) {
      expect(() => discoveryOutputPath(file, root)).toThrow();
    }
  });
  test("keeps successful results when another provider times out or rate-limits", async () => {
    const track = normalizeIncompetech(piece, {})!;
    const calls: MusicSource[] = [];
    const options = parseDiscoveryArgs(["--source", "all", "--query", "Sneaky", "--limit", "5"]);
    const result = await discoverMusic(options, {
      incompetech: async settings => { calls.push("incompetech"); expect(settings.limit).toBe(5); return { source: "incompetech", fetched: 20, accepted: 19, candidates: [track] }; },
      commons: async () => { calls.push("commons"); throw new Error("Provider timed out"); },
      ccmixter: async () => { calls.push("ccmixter"); throw new MusicSourceError("HTTP 429", 429, "60"); },
      openverse: async () => { calls.push("openverse"); return { source: "openverse", fetched: 1, accepted: 1, candidates: [{ ...track, id: "another" }] }; },
    });
    expect(calls).toHaveLength(4);
    expect(result.candidates).toHaveLength(1);
    expect(result.results).toHaveLength(2);
    expect(result.errors).toContainEqual({ source: "ccmixter", message: "HTTP 429", status: 429, retryAfter: "60" });
    expect(result.errors.find(row => row.source === "commons")?.message).toBe("Provider timed out");
  });
});
