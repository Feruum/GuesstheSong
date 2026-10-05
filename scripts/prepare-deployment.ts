import { readFile, readdir } from "node:fs/promises";
import { getDatabase, getPool } from "../src/server/db";
import { getRedis } from "../src/server/redis";
import { deploymentConfigurationIssues, initializeDeploymentDatabase, parsePublicCatalog } from "./deployment";

const issues = deploymentConfigurationIssues(process.env);
if (issues.length) {
  console.error("Deployment is missing required cloud configuration. Add these values in Vercel Settings → Environment Variables, then redeploy:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

let step = "reading the public starter catalog";
let pool: ReturnType<typeof getPool> | undefined;
let redis: ReturnType<typeof getRedis> | undefined;
try {
  const catalog = JSON.parse(await readFile(new URL("../catalog/audius-starter.json", import.meta.url), "utf8"));
  parsePublicCatalog(catalog);
  const migrations = await Promise.all((await readdir(new URL("../migrations/", import.meta.url)))
    .filter(name => /^\d+.*\.sql$/.test(name)).sort()
    .map(async name => ({ name, source: await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8") })));
  step = "connecting to Redis (check REDIS_URL, TCP/TLS access and provider availability)";
  redis = getRedis();
  await redis.ping();
  step = "connecting to PostgreSQL (check DATABASE_URL, TLS and provider availability)";
  pool = getPool();
  await pool.query("SELECT 1");
  step = "applying database migrations and initializing the catalog";
  const result = await initializeDeploymentDatabase(getDatabase(), migrations, catalog);
  if (result.playable < 10) throw new Error("Not enough available public tracks");
  console.log(`Cloud services and schema are ready. ${result.playable} public Audius songs available; ${result.seeded} seeded on this deployment.`);
} catch {
  // Provider errors can contain connection details; never echo credentials into build logs.
  console.error(`Deployment preparation failed while ${step}. No application build was started. See docs/vercel-deployment.md.`);
  process.exitCode = 1;
} finally {
  await Promise.allSettled([pool?.end(), redis?.quit()]);
}
