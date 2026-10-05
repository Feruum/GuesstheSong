"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="state-panel" data-state="error"><span className="eyebrow">A little interruption</span><h1>Let’s try that again.</h1><p>The page couldn’t load. Your saved games will be here when you reconnect.</p><div className="flex flex-wrap gap-3"><Button onClick={reset}>Try again</Button><Button asChild variant="outline"><Link href="/">Back to Discover</Link></Button></div></div>; }
