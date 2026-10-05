import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { getPool, ConfigurationError } from "./db";
import { hashToken } from "./security";
import type { GuestView } from "../shared/contracts";

export const GUEST_COOKIE = "gts_guest";
export const ADMIN_COOKIE = "gts_admin";
export async function findGuest(token: string | undefined): Promise<GuestView | null> {
  if (!token || token.length > 100) return null;
  const result = await getPool().query("SELECT id,nickname,avatar FROM guests WHERE token_hash=$1", [hashToken(token)]);
  return result.rows[0] || null;
}
export async function createGuest(): Promise<{ token: string; guest: GuestView }> {
  const token = randomBytes(32).toString("base64url");
  const guest = { id: randomUUID(), nickname: `Listener ${randomInt(1000, 10000)}`, avatar: randomInt(8) };
  await getPool().query("INSERT INTO guests(id,token_hash,nickname,avatar) VALUES($1,$2,$3,$4)", [guest.id, hashToken(token), guest.nickname, guest.avatar]);
  return { token, guest };
}
export async function updateGuest(id: string, values: Pick<GuestView, "nickname" | "avatar">): Promise<GuestView> {
  const result = await getPool().query("UPDATE guests SET nickname=$2,avatar=$3 WHERE id=$1 RETURNING id,nickname,avatar", [id, values.nickname, values.avatar]);
  return result.rows[0];
}
export async function loginAdmin(password: string): Promise<string | null> {
  const hash = process.env.ADMIN_PASSWORD_HASH || (process.env.ADMIN_PASSWORD_HASH_BASE64 ? Buffer.from(process.env.ADMIN_PASSWORD_HASH_BASE64, "base64").toString() : "");
  if (!hash) throw new ConfigurationError("Set the admin password before opening catalog management.");
  if (!await Bun.password.verify(password, hash)) return null;
  const token = randomBytes(32).toString("base64url");
  await getPool().query("INSERT INTO admin_sessions(token_hash,expires_at) VALUES($1,$2)", [hashToken(token), new Date(Date.now() + 12 * 3600000)]);
  return token;
}
export async function findAdmin(token: string | undefined): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const result = await getPool().query("SELECT 1 FROM admin_sessions WHERE token_hash=$1 AND expires_at>now()", [hashToken(token)]);
  return result.rows.length === 1;
}
export async function logoutAdmin(token: string): Promise<void> { await getPool().query("DELETE FROM admin_sessions WHERE token_hash=$1", [hashToken(token)]); }
