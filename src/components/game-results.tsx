"use client";
import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Check, Copy, Disc3, Trophy, X } from "lucide-react";
import { MODE_LABELS, type Track } from "@/shared/contracts";
import type { SoloGame } from "@/lib/api";
import { copyText, errorMessage, number } from "@/lib/utils";
import { musicSource } from "@/shared/music-source";
import { PackArtwork } from "./pack-card";
import { Button } from "./ui/button";

export function TrackAttribution({ track }: { track: Track }) {
  if (musicSource(track) === "Deezer") return <p className="attribution">{track.artist} · <a href={track.sourceUrl} target="_blank" rel="noreferrer">Listen on Deezer ↗</a><br />Official preview · Private noncommercial listening</p>;
  const license = track.license || "Open Music License";
  return <p className="attribution">© {track.artist} · Music from <a href={track.sourceUrl} target="_blank" rel="noreferrer">Audius ↗</a><br />{!track.license || /OML|Open Music/i.test(license) ? <a href="https://audius.org/open-music-license.pdf" target="_blank" rel="noreferrer">Open Music License</a> : <span>{license}</span>}</p>;
}
export function TrackThumbnail({ src }: { src: string | null }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && failedSrc !== src
    ? <Image unoptimized src={src} alt="" width={44} height={44} className="size-11 shrink-0 rounded-md object-cover" onError={() => setFailedSrc(src)} />
    : <Disc3 className="size-11 shrink-0 text-muted" aria-hidden="true" data-testid="artwork-fallback" />;
}
export function TrackArtwork({ track, className = "" }: { track: Pick<Track, "title" | "artworkUrl">; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = track.artworkUrl;
  return <div className={`reveal-art ${className}`}>
    {src && failedSrc !== src
      ? <Image unoptimized src={src} alt={`Artwork for ${track.title}`} fill sizes="225px" className="object-cover" onError={() => setFailedSrc(src)} />
      : <div className="size-full" data-testid="artwork-fallback"><PackArtwork art="global" /></div>}
  </div>;
}
export function TrackReveal({ track, score, solved }: { track: Track; score: number; solved: boolean }) { return <div className="text-center" data-testid="track-reveal"><span className="eyebrow">{solved ? "You know your music." : "A new one for your collection."}</span><TrackArtwork track={track} /><h2 className="reveal-title">{track.title}</h2><p className="reveal-artist">{track.artist}</p><p className="mt-5 text-sm text-lime">{solved ? `+${number(score)} points` : "Keep listening. The next one could be yours."}</p><TrackAttribution track={track} /></div>; }
export function GameResults({ game }: { game: SoloGame }) {
  const [shareStatus, setShareStatus] = useState(""); const daily = game.mode === "daily";
  const solved = game.history.filter(entry => entry.solved).length;
  async function share() { const blocks = game.attempts.map(attempt => attempt.correct ? "🟩" : "⬜").join("") + "⬛".repeat(Math.max(0, 6 - game.attempts.length)); const text = daily ? `guess the song · ${game.dailyDate}\n${blocks}\n${solved ? `Found it in ${game.attempts.length}/6` : "A new song discovered"}\n${location.origin}/daily` : `guess the song · ${MODE_LABELS[game.mode]}\n${number(game.score)} ${game.mode === "classic" ? "points" : "correct"}\n${location.origin}`; try { await copyText(text); setShareStatus("Result copied."); } catch (error) { setShareStatus(errorMessage(error)); } }
  return <div className="narrow-page" data-testid="game-results" data-state="complete" data-mode={game.mode}><section className="result-summary"><Trophy className="size-8 text-lime" /><span className="eyebrow">{daily ? `Daily · ${game.dailyDate}` : `${MODE_LABELS[game.mode]} · Complete`}</span><h1 className="page-title">{daily ? solved ? "A good ear. A good day." : "Now you know." : game.score > 0 ? "That's your kind of music." : "Keep discovering."}</h1><div className="results-score">{number(game.score)}</div><p className="text-sm text-muted">{game.mode === "classic" || daily ? `${solved} of ${game.history.length} songs found` : `${game.score} correct ${game.score === 1 ? "answer" : "answers"}`}</p><div className="mt-2 flex flex-wrap justify-center gap-3"><Button type="button" onClick={() => void share()}><Copy />Share result</Button><Button asChild variant="outline"><Link href={daily ? "/leaderboard?mode=daily" : `/play/${game.mode}`}>{daily ? "Today's leaderboard" : "Play again"}<ArrowUpRight /></Link></Button></div><p className="text-xs text-muted" aria-live="polite">{shareStatus || (daily ? "Your game is saved. A new song arrives at 00:00 UTC." : "Your score is saved to your guest profile.")}</p></section>{daily && game.reveal && <div className="panel mb-8"><TrackReveal track={game.reveal} score={game.history.at(-1)?.score || 0} solved={!!solved} /></div>}<section className="mt-5"><h2 className="mb-5 text-2xl">Your listening history</h2>{game.history.length ? <table className="results-table" data-testid="result-history"><thead><tr><th scope="col">Round</th><th scope="col">Song</th><th scope="col">Points</th></tr></thead><tbody>{game.history.map((entry, index) => <tr key={`${entry.track.id}-${index}`}><td><span className="flex items-center gap-2">{index + 1}{entry.solved ? <Check className="size-3 text-lime" aria-label="Found" /> : <X className="size-3 text-muted" aria-label="Missed" />}</span></td><td><a href={entry.track.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">{entry.track.title} ↗</a><span className="artist">{entry.track.artist} · {musicSource(entry.track)}</span><TrackAttribution track={entry.track} /></td><td>{number(entry.score)}</td></tr>)}</tbody></table> : <p className="panel text-sm text-muted">No songs were completed in this run. Try another round.</p>}<div className="mt-7 flex justify-center gap-5 text-sm text-muted"><Link href="/profile" className="underline underline-offset-4">Your stats</Link><Link href="/" className="underline underline-offset-4">Back to Discover</Link></div></section></div>;
}
