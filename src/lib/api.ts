import type { SoloGameView, RoomView } from "@/server/game-engine";
import type { GuestView, SoloMode, Track } from "@/shared/contracts";

export interface SoloGame extends SoloGameView { audioUrl: string | null; revision: number; dailyDate?: string | null }
export interface LiveRoom extends RoomView { audioUrl: string | null; revision: number }
export type SearchTrack = Pick<Track, "id" | "title" | "artist" | "artworkUrl" | "genre" | "releaseYear" | "language">;
export interface GuestStats {
  games: number; points: number; streak: number;
  best: { mode: string; score: number; games: number }[];
  history: { id: string; mode: string; score: number; packId: string; completedAt: string }[];
  dailyHistory: { date: string; solved: boolean }[];
}
export interface LeaderboardEntry extends GuestView { rank: number; score: number; completedAt: string }
export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); this.name = "ApiError"; }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api/v1${path}`, { ...options, credentials: "same-origin", cache: "no-store", headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } }); }
  catch { throw new ApiError("You're offline. Reconnect, then try again. Your progress is saved.", "OFFLINE", 0); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(body?.error?.message || "That didn't go through. Please try again.", body?.error?.code || "SERVICE_UNAVAILABLE", response.status);
  return body as T;
}
export const json = (value: unknown) => JSON.stringify(value);
export const soloModes: SoloMode[] = ["classic", "daily", "blitz", "chart"];
