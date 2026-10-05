import { z } from "zod";

export const gameModeSchema = z.enum(["classic", "daily", "blitz", "chart", "party", "duel"]);
export type GameMode = z.infer<typeof gameModeSchema>;
export type SoloMode = "classic" | "daily" | "blitz" | "chart";
export type RoomMode = "party" | "duel";
export const CLIP_STAGES = [1, 2, 4, 7, 11, 16] as const;
export const CLIP_SCORES = [100, 80, 60, 40, 20, 10] as const;
export const nicknameSchema = z.string().trim().min(2, "Use at least 2 characters.").max(24, "Use 24 characters or fewer.").regex(/^[\p{L}\p{N} ._\-]+$/u, "Use letters, numbers, spaces, dots, hyphens, or underscores.");
export const guestUpdateSchema = z.object({ nickname: nicknameSchema, avatar: z.number().int().min(0).max(7).default(0) });
export const startGameSchema = z.object({ mode: z.enum(["classic", "daily", "blitz", "chart"]), packId: z.string().max(80).default("global-mix"), difficulty: z.number().int().min(0).max(5).default(0), excerptMode: z.enum(["curated", "start"]).default("curated") });
export const soloCommandSchema = z.object({ id: z.string().uuid(), kind: z.enum(["guess", "skip", "next", "chart"]), trackId: z.string().max(100).optional(), choice: z.enum(["higher", "lower"]).optional() });
export const roomSettingsSchema = z.object({ packId: z.string().max(80).default("global-mix"), rounds: z.number().int().min(3).max(30).default(10), timeLimitSec: z.literal(30).default(30), startClipSec: z.literal(1).default(1), excerptMode: z.enum(["curated", "start"]).default("curated") });
export const createRoomSchema = z.object({ mode: z.enum(["party", "duel"]).default("party"), settings: roomSettingsSchema.default({ packId: "global-mix", rounds: 10, timeLimitSec: 30, startClipSec: 1, excerptMode: "curated" }) });
export const roomCommandSchema = z.object({ id: z.string().uuid(), kind: z.enum(["join", "ready", "settings", "start", "guess", "skip", "leave", "rematch", "heartbeat"]), ready: z.boolean().optional(), trackId: z.string().max(100).optional(), settings: roomSettingsSchema.optional() });
export const adminLoginSchema = z.object({ password: z.string().min(1).max(256) });
export const importSchema = z.object({ trackIds: z.array(z.string().min(1).max(100)).max(100).optional(), playlistUrl: z.string().url().max(500).optional(), packId: z.string().max(80).default("global-mix") }).refine(value => !!value.trackIds?.length || !!value.playlistUrl, { message: "Choose tracks or enter an Audius playlist URL." });
export const editTrackSchema = z.object({ title: z.string().trim().min(1).max(200).optional(), artist: z.string().trim().min(1).max(200).optional(), clipStartSec: z.number().min(0).optional(), genre: z.string().max(60).nullable().optional(), releaseYear: z.number().int().min(1900).max(2100).nullable().optional(), language: z.string().max(40).nullable().optional(), available: z.boolean().optional() });
export const editPackSchema = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(400), genre: z.string().max(60).nullable().default(null), coverArt: z.enum(["electronic", "hip-hop", "indie", "global"]).default("global") });

export interface Track {
  id: string;
  providerId: string;
  title: string;
  artist: string;
  artworkUrl: string | null;
  duration: number;
  genre: string | null;
  releaseYear: number | null;
  language: string | null;
  playCount: number;
  popularityScore?: number;
  clipStartSec: number;
  sourceUrl: string;
  license: string | null;
  available: boolean;
}
export interface GuestView { id: string; nickname: string; avatar: number }
export interface PackSummary { id: string; slug: string; name: string; description: string; genre: string | null; coverArt: "electronic" | "hip-hop" | "indie" | "global"; count: number; chartCount?: number; previewCount?: number; membership?: "automatic" | "manual" }
export interface CatalogFilters { genres: string[]; decades: number[]; languages: string[] }
export interface ApiFailure { error: { code: string; message: string } }
export const MODE_LABELS: Record<GameMode, string> = { classic: "Classic", daily: "Daily", blitz: "Blitz", chart: "Chart Clash", party: "Party", duel: "Duel" };
