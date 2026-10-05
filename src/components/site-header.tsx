"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, ArrowUpRight } from "lucide-react";
import { useGuest } from "@/hooks/use-guest";
import { AVATARS, AVATAR_COLORS, cn } from "@/lib/utils";
const links = [{ href: "/", label: "Discover" }, { href: "/daily", label: "Daily" }, { href: "/party", label: "Party" }, { href: "/leaderboard", label: "Leaderboard" }];
export function SiteHeader() {
  const path = usePathname(); const guest = useGuest().data?.guest;
  return <header className="site-header"><div className="header-main"><Link href="/" className="brand" aria-label="guess the song home"><AudioLines aria-hidden className="size-7 text-lime" /><span>guess the song</span></Link><nav aria-label="Main navigation" className="desktop-nav">{links.map(link => <Link key={link.href} href={link.href} aria-current={path === link.href ? "page" : undefined} className={cn("nav-link", path === link.href && "active")}>{link.label}</Link>)}</nav><Link href="/profile" className="profile-link" aria-label={guest ? `${guest.nickname}, your profile` : "Your profile"}><span className="avatar avatar-small" style={{ background: AVATAR_COLORS[guest?.avatar || 0] }} aria-hidden>{AVATARS[guest?.avatar || 0]}</span><span className="hidden sm:inline">{guest?.nickname || "You"}</span><ArrowUpRight className="size-4 text-muted" /></Link></div><nav aria-label="Mobile navigation" className="mobile-nav">{links.map(link => <Link key={link.href} href={link.href} aria-current={path === link.href ? "page" : undefined} className={cn("nav-link", path === link.href && "active")}>{link.label}</Link>)}</nav></header>;
}
