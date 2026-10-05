import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ConfigurationError } from "./db";

const audioClaimSchema = z.object({ guestId: z.string(), scope: z.enum(["solo", "room", "chart"]), targetId: z.string().max(100), trackIndex: z.number().int().min(0), exp: z.number() });
export type AudioClaim = Omit<z.infer<typeof audioClaimSchema>, "exp"> & { exp?: number };
function secret() {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32) throw new ConfigurationError("Configure a secure SESSION_SECRET before starting games.");
  return key;
}
export function makeAudioToken(claim: AudioClaim, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...claim, exp: now + 120000 })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}
export function verifyAudioToken(token: string, guestId: string, now = Date.now()): AudioClaim | null {
  if (token.length > 1500) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const signature = createHmac("sha256", secret()).update(parts[0]).digest();
  const received = Buffer.from(parts[1], "base64url");
  if (signature.length !== received.length || !timingSafeEqual(signature, received)) return null;
  try {
    const claim = audioClaimSchema.safeParse(JSON.parse(Buffer.from(parts[0], "base64url").toString()));
    return claim.success && claim.data.guestId === guestId && claim.data.exp > now ? claim.data : null;
  } catch { return null; }
}
export function utcDate(now = Date.now()): string { return new Date(now).toISOString().slice(0, 10); }
export function stableDailyGameId(date: string, guestId: string): string {
  const hash = createHash("sha256").update(`${date}:${guestId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function validOrigin(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  try {
    const expected = new URL(process.env.APP_URL || requestUrl).origin;
    const allowed = new Set([expected]);
    if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);
    if (!process.env.VERCEL) {
      const url = new URL(expected);
      if (["localhost", "127.0.0.1"].includes(url.hostname)) { allowed.add(`${url.protocol}//localhost:${url.port}`); allowed.add(`${url.protocol}//127.0.0.1:${url.port}`); }
    }
    return allowed.has(new URL(origin).origin);
  } catch { return false; }
}
