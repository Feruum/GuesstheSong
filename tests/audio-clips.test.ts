import { describe, expect, test } from "bun:test";
import { clipMp3, resolveByteRange } from "../src/server/audio-clips";

function mp3(seconds: number) {
  const frames = Array.from({ length: Math.ceil(seconds * 44100 / 1152) }, () => {
    const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]); return frame;
  });
  const tag = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 11]);
  return Buffer.concat([tag, Buffer.from("secret-name"), ...frames]);
}
describe("server-bounded audio", () => {
  test("one unlocked second cannot return a complete track or ID3 answer tags", () => {
    const clip = clipMp3(mp3(16), 0, 1);
    expect(clip.length).toBeLessThan(20000);
    expect(clip.toString()).not.toContain("secret-name");
    expect(clip[0]).toBe(0xff);
    expect(clip.length / 417 * 1152 / 44100).toBeLessThanOrEqual(1);
  });
  test("curated excerpts exclude the intro and remain inside their listening stage", () => {
    const clip = clipMp3(mp3(20), 7, 4);
    expect(clip.length / 417 * 1152 / 44100).toBeLessThanOrEqual(4);
    expect(clip.length / 417 * 1152 / 44100).toBeGreaterThan(3.9);
  });
  test("ranges operate only within the clip and reject out-of-bounds or multiple ranges", () => {
    expect(resolveByteRange("bytes=0-100", 50)).toEqual({ start: 0, end: 49 });
    expect(resolveByteRange("bytes=-10", 50)).toEqual({ start: 40, end: 49 });
    expect(resolveByteRange("bytes=50-", 50)).toBeNull();
    expect(resolveByteRange("bytes=0-1,3-4", 50)).toBeNull();
  });
});
