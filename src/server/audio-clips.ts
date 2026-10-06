import { streamAudius, ProviderError } from "./audius";
import { getRedis, redisKey } from "./redis";
import { deezerPreviewsEnabled, streamDeezerPreview } from "./deezer";

// Audius exposes MPEG audio. Copy complete Layer III frames, excluding metadata.
// Frame boundaries keep the emitted clip at or below the unlocked listening time.
export function clipMp3(input: Buffer, startSec: number, durationSec: number): Buffer {
  let offset = 0, time = 0;
  if (input.toString("ascii", 0, 3) === "ID3" && input.length >= 10) offset = 10 + ((input[6] & 127) << 21 | (input[7] & 127) << 14 | (input[8] & 127) << 7 | input[9] & 127) + (input[5] & 16 ? 10 : 0);
  const frames: Buffer[] = [];
  let first = true;
  while (offset + 4 <= input.length) {
    const h = input.readUInt32BE(offset);
    const version = h >>> 19 & 3, layer = h >>> 17 & 3, bitrateIndex = h >>> 12 & 15, sampleIndex = h >>> 10 & 3;
    if ((h >>> 21) !== 2047 || version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) { offset++; continue; }
    const rate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const bitrate = (version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[bitrateIndex] * 1000;
    const size = Math.floor((version === 3 ? 144 : 72) * bitrate / rate) + (h >>> 9 & 1);
    if (offset + size > input.length) break;
    const frame = input.subarray(offset, offset + size);
    const frameDuration = (version === 3 ? 1152 : 576) / rate;
    const metadata = first && /Xing|Info/.test(frame.subarray(4, Math.min(80, size)).toString("ascii"));
    first = false;
    if (!metadata) {
      if (time >= startSec && time + frameDuration <= startSec + durationSec + .00001) frames.push(frame);
      time += frameDuration;
    }
    offset += size;
    if (time >= startSec + durationSec) break;
  }
  if (!frames.length || time < startSec + durationSec - .1) throw new ProviderError("This excerpt couldn't load. Retry without losing a guess.");
  return Buffer.concat(frames);
}
export function resolveByteRange(range: string, length: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && start < length ? { start, end } : null;
}
const pending = new Map<string, Promise<Buffer>>();
export async function boundedAudiusClip(id: string, start: number, duration: number): Promise<Buffer> {
  return boundedMusicClip(id, start, duration);
}
export async function boundedMusicClip(id: string, start: number, duration: number): Promise<Buffer> {
  const preview = id.startsWith("deezer-");
  if (preview && !deezerPreviewsEnabled()) throw new ProviderError("This music source is disabled for this application.");
  if (!Number.isFinite(start) || start < 0 || duration < 1 || duration > 16) throw new ProviderError("This excerpt is unavailable.");
  const key = redisKey(`audio:${id}:${start}:${duration}`);
  const cached = await getRedis().getBuffer(key);
  if (cached) return cached;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    // Bound provider transfer too: Layer III has a maximum 320-kbit/s bitrate.
    const end = Math.ceil((start + duration + 1) * 45000 + 131072);
    const response = preview ? await streamDeezerPreview(id, `bytes=0-${end}`) : await streamAudius(id, `bytes=0-${end}`);
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; chunks.push(next.value); if (bytes >= end + 1) break; }
    } finally { await reader.cancel(); }
    const clip = clipMp3(Buffer.concat(chunks), start, duration);
    await getRedis().set(key, clip, "EX", 300);
    return clip;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
