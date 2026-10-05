import type { Metadata } from "next";
import Link from "next/link";
import { TrackThumbnail } from "@/components/game-results";
import { notFound } from "next/navigation";
import { ArrowLeft, Play, Users } from "lucide-react";
import { listPacks, searchCatalog } from "@/server/catalog";
import { PackArtwork } from "@/components/pack-card";
import { Button } from "@/components/ui/button";
import { musicSource, packDisplayName } from "@/shared/music-source";
import { number } from "@/lib/utils";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const pack = (await listPacks().catch(() => [])).find(pack => pack.slug === slug); return { title: pack ? packDisplayName(pack) : "Music pack", description: pack?.description, openGraph: pack ? { title: packDisplayName(pack), description: `${number(pack.count)} songs. ${pack.description}`, url: `/packs/${slug}` } : undefined }; }
export default async function PackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const packs = await listPacks(); const pack = packs.find(pack => pack.slug === slug); if (!pack) notFound();
  const songs = await searchCatalog({ packId: pack.id, limit: 20 });
  return <div className="narrow-page" data-testid="pack-page"><Link href="/" className="back-link"><ArrowLeft className="size-4" />Back to Discover</Link><div className="setup-grid"><PackArtwork art={pack.coverArt} /><div className="py-3"><span className="eyebrow mb-4">{pack.genre || "Find your next favorite"}</span><h1 className="page-title">{packDisplayName(pack)}</h1><p className="setup-description">{pack.description}</p><p className="mt-5 text-sm text-muted">{number(pack.count)} playable songs</p><div className="mt-7 flex flex-wrap gap-3"><Button asChild size="lg" disabled={!pack.count}><Link href={`/play/classic?pack=${pack.id}`}><Play className="fill-current" />Play this pack</Link></Button><Button asChild variant="outline"><Link href={`/party?pack=${pack.id}`}><Users />Play with friends</Link></Button></div></div></div><section className="mt-12"><h2 className="text-3xl">In the collection</h2><p className="mb-5 mt-3 text-sm text-muted">A taste of the songs you could hear. Every round shuffles the collection.</p>{songs.length ? <div className="track-list">{songs.map(track => <div key={track.id} className="track-row"><TrackThumbnail src={track.artworkUrl} /><div className="flex-1"><strong>{track.title}</strong><p>{track.artist}</p></div><a className="shrink-0 text-xs text-muted underline underline-offset-4" href={track.sourceUrl} target="_blank" rel="noreferrer">{musicSource(track)} ↗</a></div>)}</div> : <p className="panel mt-6 text-muted">No playable songs in this pack yet.</p>}</section></div>;
}
