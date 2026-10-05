import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(resolve(".data"), { recursive: true });
try { await readFile(resolve(".env.local")); console.log(".env.local already exists; existing settings were preserved."); }
catch {
  const password = randomBytes(18).toString("base64url");
  const hash = await Bun.password.hash(password, { algorithm: "argon2id", memoryCost: 65536, timeCost: 3 });
  const environment = [
    "DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:15432/postgres",
    "REDIS_URL=redis://127.0.0.1:16379", "APP_URL=http://127.0.0.1:3000",
    `SESSION_SECRET=${randomBytes(48).toString("hex")}`,
    `ADMIN_PASSWORD_HASH_BASE64=${Buffer.from(hash).toString("base64")}`,
    `CRON_SECRET=${randomBytes(32).toString("hex")}`, "AUDIUS_APP_NAME=guess-the-song",
  ].join("\n");
  await writeFile(resolve(".env.local"), environment + "\n", { mode: 0o600 });
  await writeFile(resolve(".data/admin-password.txt"), password + "\n", { mode: 0o600 });
  console.log("Local settings created. The admin password is in ignored .data/admin-password.txt. No secrets were printed.");
}
