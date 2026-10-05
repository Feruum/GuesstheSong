import { PGlite } from "@electric-sql/pglite";
import { LocalPgWireServer } from "./local-pgwire-queue";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(resolve(".data/postgres"), { recursive: true });
const database = await PGlite.create(resolve(".data/postgres"));
const port = Number(process.env.LOCAL_DATABASE_PORT || 15432);
const server = new LocalPgWireServer({ db: database, port, maxConnections: 32 });
await server.start();
console.log(`Local PostgreSQL is listening on 127.0.0.1:${port} (PGlite, development only).`);
async function stop() { await server.stop(); await database.close(); process.exit(0); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
