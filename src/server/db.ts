import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";

export class ConfigurationError extends Error { constructor(message: string) { super(message); } }
let pool: Pool | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new ConfigurationError("The song catalog isn't connected yet.");
  pool = new Pool({ connectionString, max: 3, idleTimeoutMillis: 5000, connectionTimeoutMillis: 8000, allowExitOnIdle: true });
  pool.on("error", (error) => console.error("Database connection error:", error.message));
  if (process.env.VERCEL) attachDatabasePool(pool);
  return pool;
}
export function getDatabase() { return database ??= drizzle(getPool(), { schema }); }
