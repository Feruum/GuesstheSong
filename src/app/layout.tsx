import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "./providers";
import { SiteHeader } from "@/components/site-header";
import { deezerPreviewsEnabled } from "@/server/deezer";
import "./globals.css";
export const metadata: Metadata = { metadataBase: new URL(process.env.APP_URL || "http://localhost:3000"), title: { default: "guess the song — Know it in a beat.", template: "%s · guess the song" }, description: "Hear a clip. Find the song. Guess familiar hits and discover new music with six ways to play, daily challenges and friends.", openGraph: { title: "guess the song", description: "Know it in a beat. Six ways to play, one great music collection.", type: "website", images: ["/opengraph-image"] }, twitter: { card: "summary_large_image" } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><link rel="preload" href="/fonts/space-grotesk.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /><link rel="preload" href="/fonts/dm-sans.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head><body><Providers><div id="music-app"><a className="skip-link" href="#main">Skip to content</a><SiteHeader /><main id="main" tabIndex={-1}>{children}</main><footer className="site-footer"><span>Good music. Better company.</span><div><Link href="/profile">Your stats</Link><a href="https://audius.co" target="_blank" rel="noreferrer">Music from Audius ↗</a>{deezerPreviewsEnabled() && <a href="https://www.deezer.com" target="_blank" rel="noreferrer">Previews from Deezer ↗</a>}<Link href="/admin">Catalog admin</Link></div></footer></div></Providers>{process.env.VERCEL ? <Analytics /> : null}</body></html>;
}
