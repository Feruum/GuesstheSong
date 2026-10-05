import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const number = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
export const AVATARS = ["◉", "✦", "♫", "☾", "✿", "★", "⌁", "◆"];
export const AVATAR_COLORS = ["#d7ff3f", "#efaa88", "#b8bce4", "#b9c5a3", "#dba1b5", "#eadcb6", "#93b8bb", "#d5b188"];
export const difficultyLabels = ["Mixed", "Most played", "Popular", "Regular rotation", "Deep cuts", "Hidden gems"];
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "That didn't go through. Please try again."; }
export function rankRoomPlayers<T extends { id: string; score: number }>(players: readonly T[], winnerIds: readonly string[]) {
  const winners = new Set(winnerIds);
  const sorted = [...players].sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)) || b.score - a.score);
  let rank = 1;
  return sorted.map((player, index) => {
    const previous = sorted[index - 1];
    if (previous && (winners.has(player.id) !== winners.has(previous.id) || player.score !== previous.score)) rank = index + 1;
    return { player, rank };
  });
}
export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return; }
  const field = document.createElement("textarea"); field.value = value; field.style.position = "fixed"; field.style.opacity = "0";
  document.body.appendChild(field); field.select(); const copied = document.execCommand("copy"); field.remove();
  if (!copied) throw new Error("Copy is unavailable. Select and copy the link below.");
}
