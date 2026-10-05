import { randomUUID } from "node:crypto";
import { getRedis, redisKey } from "./redis";
import { commandRoom } from "./game-service";
import { GuardChangedError } from "./atomic-store";
import type { GuestView } from "../shared/contracts";

export const presenceIndex = (code: string, guestId: string) => redisKey(`presence-index:${code}:${guestId}`);
export const presenceVersion = (code: string, guestId: string) => redisKey(`presence-version:${code}:${guestId}`);
export const presenceSeen = (code: string, guestId: string) => redisKey(`presence-seen:${code}:${guestId}`);
export async function disconnectIfAbsent(code: string, guest: GuestView, instanceLost = false) {
  const redis = getRedis();
  const guard = { key: presenceVersion(code, guest.id), value: await redis.get(presenceVersion(code, guest.id)) || "" };
  const others = await redis.smembers(presenceIndex(code, guest.id));
  if (others.length && (await Promise.all(others.map(key => redis.exists(key)))).some(Boolean)) return;
  const lastSeen = Number(await redis.get(presenceSeen(code, guest.id)) || 0);
  if (instanceLost && (!lastSeen || Date.now() - lastSeen < 1000)) return;
  try { await commandRoom(code, guest, { id: randomUUID(), kind: "disconnect" }, { guard, disconnectedAt: instanceLost ? lastSeen : undefined }); }
  catch (error) { if (!(error instanceof GuardChangedError) && !(error instanceof Error && "code" in error)) throw error; }
}
