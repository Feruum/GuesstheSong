import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getPool } from "../src/server/db";

const pool = getPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const file of (await readdir(resolve("migrations"))).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
    await client.query(await readFile(resolve("migrations", file), "utf8"));
  }
  await client.query("COMMIT");
  console.log("Database schema and starter packs are ready.");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
