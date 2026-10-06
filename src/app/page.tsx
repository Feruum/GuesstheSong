import Link from "next/link";
import { ArrowUpRight, CalendarDays, Play, Users, Zap, Swords, TrendingUp, Disc3 } from "lucide-react";
import { listPacks, catalogFilters, searchCatalog } from "@/server/catalog";
import { DEFAULT_PACKS, type CatalogPackKind } from "@/server/catalog-packs";
import type { CatalogFilters, PackSummary, Track } from "@/shared/contracts";
import { PackArtwork, PackCard } from "@/components/pack-card";
import { TrackThumbnail } from "@/components/game-results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { number } from "@/lib/utils";
import { deezerPreviewsEnabled } from "@/server/deezer";

export const dynamic = "force-dynamic";
const modes = [
  { id: "classic", name: "Classic", text: "Ten songs. Six guesses each. Find your rhythm.", icon: Disc3, href: "/play/classic" },
  { id: "daily", name: "Daily", text: "One shared song from 100 hitmakers, every UTC day.", icon: CalendarDays, href: "/daily" },
  { id: "party", name: "Party", text: "Same songs. Your favorite people. Up to 24 players.", icon: Users, href: "/party" },
  { id: "blitz", name: "Blitz", text: "45 seconds. Every correct answer buys you ten more.", icon: Zap, href: "/play/blitz" },
  { id: "duel", name: "Duel", text: "Two listeners. Seven rounds. Be the first to know.", icon: Swords, href: "/duel" },
  { id: "chart", name: "Chart Clash", text: "More plays or fewer? Follow your musical instinct.", icon: TrendingUp, href: "/play/chart" },
];
const collectionGroups: { kind: CatalogPackKind; title: string; text: string }[] = [
  { kind: "mix", title: "Start with a mix", text: "Familiar artists, new discoveries, or the whole collection." },
  { kind: "genre", title: "By genre", text: "Pop, hip-hop, indie, rock, R&B, jazz, Latin, and more. Pick your sound." },
  { kind: "decade", title: "Through the decades", text: "Pick an era. Collections follow each song’s release date." },
];
const packKinds = new Map<string, CatalogPackKind>(DEFAULT_PACKS.map(pack => [pack.id, pack.kind]));
const packOrder = new Map<string, number>(DEFAULT_PACKS.map((pack, index) => [pack.id, index]));
const discoveryRank = (id: string) => id === "featured-hits" ? -2 : id === "hits" ? -1 : packOrder.get(id) ?? 100;

export default async function Discover({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const genre = typeof params.genre === "string" ? params.genre : "";
  const requestedDecade = typeof params.decade === "string" && params.decade ? Number(params.decade) : undefined;
  const decade = requestedDecade && Number.isInteger(requestedDecade) && requestedDecade >= 1900 && requestedDecade <= 2100 && requestedDecade % 10 === 0 ? requestedDecade : undefined;
  const language = typeof params.language === "string" ? params.language : "";
  let packs: PackSummary[] = [];
  let filters: CatalogFilters = { genres: [], decades: [], languages: [] };
  let songs: Track[] = [];
  let unavailable = false;
  try {
    [packs, filters, songs] = await Promise.all([
      listPacks(), catalogFilters(),
      q || genre || decade || language ? searchCatalog({ query: q, genre: genre || undefined, decade, language: language || undefined, limit: 24 }) : Promise.resolve([]),
    ]);
  } catch { unavailable = true; }
  const playablePacks = packs.filter(pack => pack.count >= 10).sort((a, b) => discoveryRank(a.id) - discoveryRank(b.id) || a.name.localeCompare(b.name));
  const hasTracks = playablePacks.length > 0;
  const filtered = !!(q || genre || decade || language);
  const total = packs.find(pack => pack.id === "global-mix")?.count || 0;
  const featuredPack = playablePacks.find(pack => pack.id === "featured-hits") || playablePacks.find(pack => pack.id === "hits");
  return <div className="page-container" data-testid="discover-page" data-state={unavailable ? "error" : hasTracks ? "ready" : "empty"}>
    <section className="hero-grid">
      <div className="hero-copy">
        <span className="eyebrow mb-5">A little listening goes a long way</span>
        <h1 className="display-title">Know it<br />in a beat.</h1>
        <p>Hear a clip. Find the song.<br />Your next favorite is waiting.</p>
        <div className="hero-actions">
          <Button asChild size="lg"><Link href={featuredPack ? `/play/classic?pack=${featuredPack.id}` : "/play/classic"}><Play className="fill-current" />Start guessing</Link></Button>
          <Button asChild variant="outline" size="lg"><Link href="/party"><Users />Play with friends</Link></Button>
        </div>
        <p className="!mt-5 !text-xs text-muted">{total ? `${number(total)} songs. Six ways to play.` : "Independent sounds. Six ways to play."}</p>
      </div>
      <div className="hero-record"><PackArtwork art="global" /></div>
      <aside className="daily-card">
        <div className="flex items-center gap-2 text-sm"><CalendarDays className="size-4" />Daily challenge</div>
        <h2>One song. <br />Six guesses.</h2>
        <div className="mini-wave" aria-hidden>{Array.from({ length: 29 }, (_, i) => <i key={i} style={{ height: `${10 + ((i * 17 + 9) % 34)}px` }} />)}</div>
        <Button asChild size="lg"><Link href="/daily"><Play className="fill-current" />Play today’s song</Link></Button>
        <span className="eyebrow">100 hitmakers · New song at 00:00 UTC</span>
      </aside>
    </section>
    <section className="catalog-section" aria-labelledby="catalog-title">
      <div className="catalog-top">
        <div><h2 id="catalog-title" className="section-title">Find your sound.</h2><p>Choose a genre, revisit a decade, or explore the whole mix.</p></div>
        <span className="eyebrow mt-3">{deezerPreviewsEnabled() ? "Music from Audius & Deezer" : "Music from Audius"}</span>
      </div>
      <form key={JSON.stringify([q, genre, decade, language])} action="/" method="get" className="catalog-filters" role="search">
        <label><span className="sr-only">Search songs or artists</span><Input name="q" placeholder="Search songs or artists" defaultValue={q} maxLength={100} /></label>
        {filters.genres.length > 0 && <label><span className="sr-only">Genre</span><select aria-label="Genre" name="genre" defaultValue={genre}><option value="">Every genre</option>{filters.genres.map(value => <option key={value}>{value}</option>)}</select></label>}
        {filters.decades.length > 0 && <label><span className="sr-only">Decade</span><select aria-label="Decade" name="decade" defaultValue={decade || ""}><option value="">Every decade</option>{filters.decades.map(value => <option key={value} value={value}>{value}s</option>)}</select></label>}
        {filters.languages.length > 0 && <label><span className="sr-only">Language</span><select aria-label="Language" name="language" defaultValue={language}><option value="">Every language</option>{filters.languages.map(value => <option key={value}>{value}</option>)}</select></label>}
        <Button type="submit" variant="outline">Find music<ArrowUpRight /></Button>
      </form>
      {unavailable ? <div className="panel" role="status">
        <h3 className="text-2xl">The collection is taking a moment.</h3><p className="mt-3 text-muted">Refresh to try loading the music again.</p>
        <Button asChild variant="outline" className="mt-5"><Link href="/">Reload collection</Link></Button>
      </div> : filtered ? <>
        <div className="mb-5 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">{songs.length ? `${songs.length} matching songs${songs.length === 24 ? " · Showing the first 24" : ""}` : "No matching songs. Try another artist or remove a filter."}</p>
          <Link href="/" className="text-sm underline underline-offset-4">Clear filters</Link>
        </div>
        <div className="track-list" data-testid="catalog-results">{songs.map(track => <div className="track-row" key={track.id}>
          <TrackThumbnail src={track.artworkUrl} />
          <div className="flex-1"><strong>{track.title}</strong><p>{track.artist}</p></div><span className="hidden text-xs text-muted sm:block">{track.genre}</span>
        </div>)}</div>
        {(() => {
          const matchingPack = !q && !language ? playablePacks.find(pack => genre ? pack.genre === genre && packKinds.get(pack.id) === "genre" && !decade : decade ? pack.id === `${decade}s` : false) : undefined;
          return <Button asChild className="mt-6"><Link href={matchingPack ? `/play/classic?pack=${matchingPack.id}` : "/play/classic"}>{matchingPack ? `Play ${matchingPack.genre || `${decade}s`}` : "Play the global mix"}<Play /></Link></Button>;
        })()}
      </> : hasTracks ? <div className="space-y-10">{collectionGroups.map(group => {
        const items = playablePacks.filter(pack => (packKinds.get(pack.id) || "mix") === group.kind);
        if (!items.length) return null;
        return <section key={group.kind} aria-labelledby={`collection-${group.kind}`} data-testid={`collections-${group.kind}`}>
          <h3 id={`collection-${group.kind}`} className="mb-2 text-2xl">{group.title}</h3><p className="mb-5 text-sm text-muted">{group.text}</p>
          <div className="pack-grid">{items.map(pack => <PackCard key={pack.id} pack={pack} />)}</div>
        </section>;
      })}</div> : <div className="panel" data-state="empty">
        <h3 className="text-2xl">A new collection is on the way.</h3><p className="mt-3 text-muted">There are no playable songs yet. Add eligible Audius songs in the catalog admin.</p>
        <Button asChild variant="outline" className="mt-5"><Link href="/admin">Open catalog admin</Link></Button>
      </div>}
    </section>
    <section className="mt-14" aria-labelledby="modes-title">
      <div className="flex items-center justify-between gap-5"><h2 id="modes-title" className="section-title">Your game. Your tempo.</h2><span className="hidden text-xs text-muted sm:block">Pick a way to play</span></div>
      <div className="mode-grid">{modes.map(mode => <Link key={mode.id} href={mode.href} className="mode-card" data-mode={mode.id}>
        <mode.icon className="size-6" /><div><h3>{mode.name}</h3><p>{mode.text}</p></div>
      </Link>)}</div>
    </section>
  </div>;
}
