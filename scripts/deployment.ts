import { and, eq, notLike, sql } from "drizzle-orm";
import { z } from "zod";
import type { getDatabase } from "../src/server/db";
import { tracks } from "../src/server/schema";
import { organizeCatalog } from "../src/server/catalog";
import type { Track } from "../src/shared/contracts";
import { publicPreviewsEnabled } from "../src/server/deezer";

function publicUrl(value: string | undefined): URL | null {
  try {
    const url = new URL(value ?? "");
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
      || host === "::1" || host === "::" || /^127\.|^0\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url;
  } catch { return null; }
}
export function deploymentConfigurationIssues(env: Record<string, string | undefined>): string[] {
  const issues: string[] = [];
  const database = publicUrl(env.DATABASE_URL);
  if (!database || !["postgres:", "postgresql:"].includes(database.protocol)
    || !["require", "verify-ca", "verify-full"].includes(database.searchParams.get("sslmode") ?? "")) {
    issues.push("DATABASE_URL must be a cloud PostgreSQL URL with TLS.");
  }
  const redis = publicUrl(env.REDIS_URL);
  if (!redis || redis.protocol !== "rediss:") issues.push("REDIS_URL must be a cloud Redis TCP/TLS URL (rediss://).");
  if ((env.SESSION_SECRET?.length ?? 0) < 32) issues.push("SESSION_SECRET must contain at least 32 characters.");
  const app = publicUrl(env.APP_URL);
  if (!app || app.protocol !== "https:" || app.username || app.password || app.search || app.hash || app.pathname !== "/") {
    issues.push("APP_URL must be the exact public HTTPS origin.");
  }
  if (env.DEEZER_PUBLIC_PREVIEWS_APPROVED === "true" && !publicPreviewsEnabled(env)) {
    issues.push("DEEZER_PUBLIC_PREVIEWS_ORIGIN must match the exact HTTPS APP_URL when public previews are approved.");
  }
  return issues;
}

const publicTrackSchema = z.object({
  id: z.string().regex(/^audius-[a-zA-Z0-9_-]+$/), providerId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  title: z.string().min(1).max(200), artist: z.string().min(1).max(200),
  artworkUrl: z.string().url().refine(value => {
    const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search;
  }).nullable(),
  duration: z.number().int().min(16).max(720), genre: z.string().nullable(),
  releaseYear: z.number().int().min(1900).max(2100).nullable(), language: z.string().nullable(),
  playCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), popularityScore: z.number().int().nonnegative().optional(),
  clipStartSec: z.number().int().nonnegative(),
  sourceUrl: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "audius.co" && !url.username && !url.password && !url.search && !url.hash;
  }),
  license: z.enum(["All rights reserved", "OML", "CC0", "CC BY", "CC BY-SA", "CC-BY", "CC-BY-SA"]).nullable(),
  available: z.literal(true),
}).strict().refine(track => track.id === `audius-${track.providerId}` && track.clipStartSec <= track.duration - 16);
const publicCatalogSchema = z.object({
  version: z.literal(1), exportedAt: z.string().datetime().optional(),
  tracks: z.array(publicTrackSchema).min(1).max(2000),
}).strict().refine(catalog => new Set(catalog.tracks.map(track => track.id)).size === catalog.tracks.length);

export function parsePublicCatalog(input: unknown): Track[] {
  const parsed = publicCatalogSchema.safeParse(input);
  if (!parsed.success) throw new Error("The starter catalog must contain valid, unique public Audius metadata only.");
  return parsed.data.tracks;
}

export async function initializeDeploymentDatabase(
  db: ReturnType<typeof getDatabase>, migrations: { name: string; source: string }[], catalog: unknown,
): Promise<{ seeded: number; playable: number }> {
  const starterTracks = parsePublicCatalog(catalog);
  return db.transaction(async tx => {
    // Serialize deployments before either schema creation or first catalog import.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(714392018, 1)`);
    for (const migration of migrations) await tx.execute(sql.raw(migration.source));
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS deployment_initializations (id text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now())`);
    const initialized = await tx.execute(sql`SELECT id FROM deployment_initializations WHERE id = 'public-catalog-v1'`);
    let seeded = 0;
    if (!initialized.rows.length) {
      const [existing] = await tx.select({ count: sql<number>`count(*)::integer` }).from(tracks);
      if (!existing.count) {
        for (let offset = 0; offset < starterTracks.length; offset += 250) {
          await tx.insert(tracks).values(starterTracks.slice(offset, offset + 250));
        }
        await organizeCatalog(tx as unknown as ReturnType<typeof getDatabase>);
        seeded = starterTracks.length;
      }
      await tx.execute(sql`INSERT INTO deployment_initializations (id) VALUES ('public-catalog-v1')`);
    }
    const [result] = await tx.select({ count: sql<number>`count(*)::integer` }).from(tracks)
      .where(and(eq(tracks.available, true), notLike(tracks.id, "deezer-%")));
    return { seeded, playable: result.count };
  });
}
