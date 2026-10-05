import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { AtomicStore, GuardChangedError } from "../src/server/atomic-store";
import { listPacks } from "../src/server/catalog";
import { createGuest, findGuest, loginAdmin, findAdmin, logoutAdmin } from "../src/server/sessions";
import { getPool } from "../src/server/db";

describe("real database and Redis", () => {
  test("catalog pack counts come from playable PostgreSQL tracks", async () => {
    const packs = await listPacks();
    expect(packs.find(pack => pack.id === "global-mix")?.name).toBe("The global mix");
    expect(packs.every(pack => Number.isInteger(pack.count))).toBe(true);
  });
  test("guest tokens resume a private profile and only their hashes are stored", async () => {
    const session = await createGuest();
    try {
      expect(await findGuest(session.token)).toEqual(session.guest);
      expect(await findGuest(randomUUID())).toBeNull();
      const row = (await getPool().query("SELECT token_hash FROM guests WHERE id=$1", [session.guest.id])).rows[0];
      expect(row.token_hash).not.toBe(session.token);
      expect(row.token_hash.length).toBe(64);
    } finally { await getPool().query("DELETE FROM guests WHERE id=$1", [session.guest.id]); }
  });
  test("admin sessions reject wrong passwords and revoke on logout", async () => {
    const previous = process.env.ADMIN_PASSWORD_HASH_BASE64;
    process.env.ADMIN_PASSWORD_HASH_BASE64 = Buffer.from(await Bun.password.hash("test-admin-password-123", { algorithm: "argon2id" })).toString("base64");
    try {
      expect(await loginAdmin("wrong password")).toBeNull();
      const token = await loginAdmin("test-admin-password-123");
      expect(token).toBeString();
      expect(await findAdmin(token!)).toBe(true);
      await logoutAdmin(token!);
      expect(await findAdmin(token!)).toBe(false);
    } finally { process.env.ADMIN_PASSWORD_HASH_BASE64 = previous; }
  });
  test("24 simultaneous Redis writers lose no authoritative updates", async () => {
    const redis = new Redis(process.env.REDIS_URL!);
    const store = new AtomicStore(redis, `test:${randomUUID()}`);
    const id = "race";
    try {
      await store.create(id, { count: 0 });
      await Promise.all(Array.from({ length: 24 }, () => store.update<{count: number}>(id, value => ({ count: value.count + 1 }))));
      expect((await store.load<{count: number}>(id))?.value.count).toBe(24);
    } finally { await store.remove(id); await redis.quit(); }
  });
  test("a reconnect version prevents a delayed disconnect from overwriting presence", async () => {
    const redis = new Redis(process.env.REDIS_URL!); const prefix = `test:${randomUUID()}`; const store = new AtomicStore(redis, prefix);
    try {
      await store.create("guarded", { online: true });
      await redis.set(`${prefix}:connection`, "2");
      await expect(store.update("guarded", () => ({ online: false }), 60, { key: `${prefix}:connection`, value: "1" })).rejects.toBeInstanceOf(GuardChangedError);
      expect((await store.load<{online: boolean}>("guarded"))!.value.online).toBe(true);
    } finally { await redis.del(`${prefix}:connection`); await store.remove("guarded"); await redis.quit(); }
  });
});
