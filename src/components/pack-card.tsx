import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PackSummary } from "@/shared/contracts";
import { cn, number } from "@/lib/utils";
import { packDisplayName } from "@/shared/music-source";
export function PackArtwork({ art = "global", className }: { art?: PackSummary["coverArt"]; className?: string }) {
  const titles = { global: <>MUSIC<br />BRINGS<br />US CLOSER.</>, electronic: <>AFTER<br />HOURS.<br />ON REPEAT.</>, "hip-hop": <>MORE<br />THAN<br />MUSIC.</>, indie: <>TAKE<br />THE LONG<br />WAY HOME.</> };
  return <div className={cn("pack-art", art, className)} aria-hidden="true"><span className="sleeve-title">{titles[art]}</span><span className="sleeve-kicker">Good songs<br />Brighter days<br />Vol. 01</span></div>;
}
export function PackCard({ pack }: { pack: PackSummary }) {
  return <Link href={`/packs/${pack.slug}`} className="pack-card" data-testid="pack-card"><PackArtwork art={pack.coverArt} /><div className="flex items-start justify-between gap-3"><h3>{packDisplayName(pack)}</h3><ArrowUpRight className="mt-4 size-4 shrink-0 text-muted" aria-hidden /></div><p>{number(pack.count)} songs{packDisplayName(pack) !== pack.name ? ` · ${pack.name}` : pack.genre ? ` · ${pack.genre}` : ""}</p></Link>;
}
