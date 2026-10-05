import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { adminLoginSchema, createRoomSchema, editPackSchema, editTrackSchema, guestUpdateSchema, importSchema, roomCommandSchema, soloCommandSchema, startGameSchema, type GuestView, type SoloMode } from "../shared/contracts";
import { ADMIN_COOKIE, GUEST_COOKIE, createGuest, findAdmin, findGuest, loginAdmin, logoutAdmin, updateGuest } from "./sessions";
import { assertImportTarget, CatalogError, catalogFilters, catalogTrack, importTracks, listPacks, refreshCatalog, searchCatalog, attachToPack, removePackTrack, updateCatalogTrack } from "./catalog";
import { getAudiusPlaylistTracks, getAudiusTrack, ProviderError, searchAudius } from "./audius";
import { boundedMusicClip, resolveByteRange } from "./audio-clips";
import { GameError } from "./game-engine";
import { ConfigurationError, getPool } from "./db";
import { getRedis, rateLimit, redisKey } from "./redis";
import { MissingStateError } from "./atomic-store";
import { audioTrack, cancelMatch, commandRoom, commandSolo, getRoom, getSolo, guestStats, leaderboard, matchmaking, newRoom, startSolo } from "./game-service";
import { validOrigin, verifyAudioToken } from "./security";

type Variables = { guest: GuestView };
export const app = new Hono<{ Variables: Variables }>().basePath("/api/v1");
app.use("*", bodyLimit({ maxSize: 65536, onError: c => c.json({ error: { code: "BODY_TOO_LARGE", message: "This request is too large." } }, 413) }));
app.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && !validOrigin(c.req.header("Origin") || null, c.req.url)) return c.json({ error: { code: "INVALID_ORIGIN", message: "Open the game on this site before continuing." } }, 403);
  await next();
});
app.onError((error, c) => {
  if (error instanceof z.ZodError) return c.json({ error: { code: "INVALID_INPUT", message: error.issues[0]?.message || "Check your input." } }, 400);
  if (error instanceof CatalogError) return c.json({ error: { code: error.code, message: error.message } }, error.status as ContentfulStatusCode);
  if (error instanceof GameError || error instanceof ProviderError) return c.json({ error: { code: error instanceof GameError ? error.code : "AUDIO_UNAVAILABLE", message: error.message } }, error.status as ContentfulStatusCode);
  if (error instanceof MissingStateError) return c.json({ error: { code: "EXPIRED", message: error.message } }, 410);
  if (error instanceof ConfigurationError) return c.json({ error: { code: "NOT_CONFIGURED", message: error.message } }, 503);
  if (error instanceof SyntaxError) return c.json({ error: { code: "INVALID_INPUT", message: "Send a valid request." } }, 400);
  console.error("API request failed:", error.message);
  return c.json({ error: { code: "SERVICE_UNAVAILABLE", message: "That didn't go through. Please try again." } }, 503);
});
const cookieOptions = (url: string, maxAge: number) => ({ httpOnly: true, sameSite: "Lax" as const, secure: new URL(url).protocol === "https:", path: "/", maxAge });
app.get("/health", async c => { await getPool().query("SELECT 1"); await getRedis().ping(); return c.json({ status: "ok" }); });
app.get("/guest", async c => {
  let guest = await findGuest(getCookie(c, GUEST_COOKIE));
  if (!guest) { const session = await createGuest(); guest = session.guest; setCookie(c, GUEST_COOKIE, session.token, cookieOptions(c.req.url, 365 * 86400)); }
  return c.json({ guest });
});
app.get("/packs", async c => c.json({ packs: await listPacks(), filters: await catalogFilters() }));
app.get("/catalog/search", async c => {
  const query = z.object({ q: z.string().max(100).optional(), packId: z.string().max(80).optional(), genre: z.string().max(60).optional(), decade: z.coerce.number().int().min(1900).max(2100).optional(), language: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).max(100000).default(0) }).parse(c.req.query());
  const tracks = await searchCatalog({ ...query, query: query.q });
  // Public search supports guesses without disclosing Chart Clash's frozen counts.
  return c.json({ tracks: tracks.map(({ id, title, artist, artworkUrl, genre, releaseYear, language }) => ({ id, title, artist, artworkUrl, genre, releaseYear, language })) });
});
app.use("/admin/*", async (c, next) => {
  if (c.req.path.endsWith("/login") || c.req.path.endsWith("/session")) return next();
  if (!await findAdmin(getCookie(c, ADMIN_COOKIE))) return c.json({ error: { code: "ADMIN_REQUIRED", message: "Sign in to manage the music catalog." } }, 401);
  await next();
});
app.post("/admin/login", async c => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!await rateLimit(`admin-login:${ip}`, 5, 300) || !await rateLimit("admin-login:global", 100, 3600)) return c.json({ error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again in five minutes." } }, 429);
  const input = adminLoginSchema.parse(await c.req.json());
  const token = await loginAdmin(input.password);
  if (!token) return c.json({ error: { code: "INVALID_PASSWORD", message: "That password is incorrect." } }, 401);
  setCookie(c, ADMIN_COOKIE, token, cookieOptions(c.req.url, 43200));
  return c.json({ authenticated: true });
});
app.get("/admin/session", async c => c.json({ authenticated: await findAdmin(getCookie(c, ADMIN_COOKIE)) }));
app.post("/admin/logout", async c => { const token = getCookie(c, ADMIN_COOKIE); if (token) await logoutAdmin(token); deleteCookie(c, ADMIN_COOKIE, { path: "/" }); return c.json({ authenticated: false }); });
app.get("/admin/catalog", async c => c.json({ tracks: await searchCatalog({ query: c.req.query("q")?.slice(0, 100), packId: c.req.query("packId"), offset: Math.max(0, Number(c.req.query("offset") || 0)), limit: 50, includeUnavailable: true }), packs: await listPacks() }));
app.get("/admin/audius", async c => {
  const query = z.string().trim().min(2).max(100).parse(c.req.query("q"));
  return c.json({ tracks: await searchAudius(query, 25) });
});
app.post("/admin/import", async c => {
  const input = importSchema.parse(await c.req.json());
  assertImportTarget(input.packId);
  const tracks = input.playlistUrl ? await getAudiusPlaylistTracks(input.playlistUrl) : (await Promise.all((input.trackIds || []).map(getAudiusTrack))).filter((track): track is NonNullable<typeof track> => !!track);
  return c.json({ ...await importTracks(tracks, input.packId), skipped: (input.trackIds?.length || tracks.length) - tracks.length });
});
app.patch("/admin/tracks/:id", async c => {
  const id = c.req.param("id"); const track = await catalogTrack(id);
  if (!track) throw new GameError("NOT_FOUND", "That song was not found.", 404);
  const input = editTrackSchema.parse(await c.req.json());
  if (input.clipStartSec !== undefined && input.clipStartSec > track.duration - 16) throw new GameError("INVALID_EXCERPT", "Leave at least 16 seconds after the excerpt start.", 400);
  return c.json({ track: await updateCatalogTrack(id, input) });
});
app.post("/admin/packs", async c => {
  const input = editPackSchema.parse(await c.req.json());
  const id = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55) || "pack"}-${randomUUID().slice(0, 6)}`;
  await getPool().query("INSERT INTO packs(id,slug,name,description,genre,cover_art) VALUES($1,$1,$2,$3,$4,$5)", [id, input.name, input.description, input.genre, input.coverArt]);
  return c.json({ pack: (await listPacks()).find(pack => pack.id === id) }, 201);
});
app.patch("/admin/packs/:id", async c => { const input = editPackSchema.parse(await c.req.json()); await getPool().query("UPDATE packs SET name=$2,description=$3,genre=$4,cover_art=$5 WHERE id=$1", [c.req.param("id"), input.name, input.description, input.genre, input.coverArt]); return c.json({ packs: await listPacks() }); });
app.post("/admin/packs/:id/tracks", async c => { const input = z.object({ trackIds: z.array(z.string().max(100)).min(1).max(100) }).parse(await c.req.json()); return c.json({ attached: await attachToPack(c.req.param("id"), input.trackIds) }); });
app.delete("/admin/packs/:id/tracks/:trackId", async c => { await removePackTrack(c.req.param("id"), c.req.param("trackId")); return c.json({ removed: true }); });
app.post("/admin/refresh", async c => { const input = z.object({ offset: z.number().int().min(0).max(100000).default(0) }).parse(await c.req.json()); return c.json(await refreshCatalog(25, input.offset)); });
app.get("/catalog/refresh", async c => {
  if (!process.env.CRON_SECRET || c.req.header("Authorization") !== `Bearer ${process.env.CRON_SECRET}`) return c.json({ error: { code: "FORBIDDEN", message: "This action is protected." } }, 403);
  const offset = Number(await getRedis().get(redisKey("refresh-offset")) || 0);
  const result = await refreshCatalog(25, offset); await getRedis().set(redisKey("refresh-offset"), result.nextOffset || 0);
  return c.json(result);
});

// All game routes require the browser-bound identity; player IDs never come from a request body.
app.use("*", async (c, next) => {
  const guest = await findGuest(getCookie(c, GUEST_COOKIE));
  if (!guest) return c.json({ error: { code: "GUEST_REQUIRED", message: "Open the game again to restore your guest profile." } }, 401);
  if (!await rateLimit(`guest:${guest.id}`, c.req.path.includes("/audio/") ? 180 : 300, 60)) return c.json({ error: { code: "RATE_LIMITED", message: "Take a moment, then try again." } }, 429);
  c.set("guest", guest); await next();
});
app.patch("/guest", async c => c.json({ guest: await updateGuest(c.get("guest").id, guestUpdateSchema.parse(await c.req.json())) }));
app.get("/stats", async c => c.json({ stats: await guestStats(c.get("guest").id) }));
app.get("/leaderboards", async c => { const input = z.object({ mode: z.enum(["classic", "daily", "blitz", "chart"]).default("classic"), period: z.enum(["all", "week", "today"]).default("all"), packId: z.string().max(80).optional(), difficulty: z.coerce.number().int().min(0).max(5).optional() }).parse(c.req.query()); return c.json({ entries: await leaderboard(input.mode as SoloMode, input.period, input.packId, input.difficulty) }); });
app.post("/games", async c => c.json(await startSolo(c.get("guest"), startGameSchema.parse(await c.req.json())), 201));
app.get("/games/:id", async c => c.json(await getSolo(z.string().uuid().parse(c.req.param("id")), c.get("guest").id)));
app.post("/games/:id/commands", async c => c.json(await commandSolo(z.string().uuid().parse(c.req.param("id")), c.get("guest").id, soloCommandSchema.parse(await c.req.json()))));
app.get("/daily", async c => c.json(await startSolo(c.get("guest"), { mode: "daily", packId: "global-mix", difficulty: 0, excerptMode: "curated" })));
app.post("/rooms", async c => c.json(await newRoom(c.get("guest"), createRoomSchema.parse(await c.req.json())), 201));
app.get("/rooms/:code", async c => c.json(await getRoom(z.string().regex(/^[A-Za-z0-9]{6}$/).parse(c.req.param("code")), c.get("guest").id)));
app.post("/rooms/:code/commands", async c => c.json(await commandRoom(z.string().regex(/^[A-Za-z0-9]{6}$/).parse(c.req.param("code")), c.get("guest"), roomCommandSchema.parse(await c.req.json()))));
app.post("/matchmaking", async c => c.json(await matchmaking(c.get("guest"))));
app.delete("/matchmaking", async c => { await cancelMatch(c.get("guest").id); return c.json({ status: "cancelled" }); });
app.get("/audio/:token", async c => {
  const claim = verifyAudioToken(c.req.param("token"), c.get("guest").id);
  if (!claim) throw new GameError("AUDIO_EXPIRED", "Refresh this round to replay the clip.", 403);
  const track = await audioTrack(claim.scope, claim.targetId, claim.trackIndex, c.get("guest").id);
  if (!track || !track.available || !(await catalogTrack(track.id))?.available) throw new GameError("AUDIO_UNAVAILABLE", "This clip is unavailable. Your guesses are saved.", 503);
  const clip = await boundedMusicClip(track.providerId, track.clipStartSec, track.clipDurationSec);
  const headers = new Headers({ "Cache-Control": "private, no-store", "Content-Type": "audio/mpeg", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" });
  const range = c.req.header("Range");
  if (range) {
    const part = resolveByteRange(range, clip.length);
    if (!part) { headers.set("Content-Range", `bytes */${clip.length}`); return new Response(null, { status: 416, headers }); }
    const bytes = clip.subarray(part.start, part.end + 1);
    headers.set("Content-Range", `bytes ${part.start}-${part.end}/${clip.length}`); headers.set("Content-Length", String(bytes.length));
    return new Response(new Uint8Array(bytes), { status: 206, headers });
  }
  headers.set("Content-Length", String(clip.length));
  return new Response(new Uint8Array(clip), { status: 200, headers });
});
app.notFound(c => c.json({ error: { code: "NOT_FOUND", message: "That page was not found." } }, 404));
