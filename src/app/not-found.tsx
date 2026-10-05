import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() { return <div className="state-panel" data-state="not-found"><span className="eyebrow">404 · A missing track</span><h1>Nothing playing here.</h1><p>This page or music pack couldn’t be found.</p><Button asChild><Link href="/">Back to Discover</Link></Button></div>; }
