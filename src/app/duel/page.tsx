"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Swords, LoaderCircle } from "lucide-react";
import { useGuest } from "@/hooks/use-guest";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { RoomEntrance } from "@/components/room-settings";
import { Button } from "@/components/ui/button";
export default function DuelPage() {
  const guest = useGuest(); const router = useRouter(); const [searching, setSearching] = useState(false); const [error, setError] = useState<string | null>(null); const searchEpoch = useRef(0);
  useEffect(() => {
    if (!searching) return; const epoch = ++searchEpoch.current; let stopped = false; let matched = false; let timer: ReturnType<typeof setTimeout>;
    async function match() { try { const result = await api<{ status: "waiting" | "matched"; code?: string }>("/matchmaking", { method: "POST" }); if (stopped || epoch !== searchEpoch.current) return; if (result.status === "matched" && result.code) { matched = true; setSearching(false); router.push(`/rooms/${result.code}`); } else timer = setTimeout(match, 2000); } catch (error) { if (!stopped && epoch === searchEpoch.current) { setError(errorMessage(error)); setSearching(false); } } }
    void match(); return () => { stopped = true; clearTimeout(timer); if (!matched) void api("/matchmaking", { method: "DELETE", keepalive: true }).catch(() => undefined); };
  }, [searching, router]);
  async function cancel() { searchEpoch.current++; setSearching(false); setError(null); try { await api("/matchmaking", { method: "DELETE" }); } catch (error) { setError(errorMessage(error)); } }
  return <div className="page-container max-w-[1120px]" data-testid="duel-page" data-state={searching ? "matchmaking" : "setup"}><span className="eyebrow mb-4">Headphones on. Game on.</span><h1 className="page-title">Two ears. One winner.</h1><p className="mb-8 mt-4 text-lg text-muted">Seven rounds. The first correct answer earns the point.</p><div className="panel mb-8 flex flex-wrap items-center justify-between gap-5"><div className="flex items-center gap-4">{searching ? <LoaderCircle className="size-7 shrink-0 text-lime motion-safe:animate-spin" /> : <Swords className="size-7 shrink-0 text-lime" />}<div><h2 className="text-2xl">{searching ? "Finding your next rival…" : "Meet your match."}</h2><p className="mt-2 text-sm text-muted">{searching ? "Keep this page open while we find another listener." : "Play against another listener, or invite someone you know."}</p></div></div><Button disabled={!guest.data} variant={searching ? "outline" : "default"} onClick={() => { if (searching) void cancel(); else { setError(null); setSearching(true); } }}>{searching ? "Cancel search" : "Find an opponent"}</Button></div>{error && <p className="error-notice mb-6" role="alert">{error}</p>}{!searching && <RoomEntrance mode="duel" />}</div>;
}
