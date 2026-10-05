import { Disc3 } from "lucide-react";
export default function Loading() { return <div className="state-panel" data-testid="page-loading" data-state="loading" role="status"><Disc3 className="size-10 text-lime motion-safe:animate-spin" /><h1>Getting the music ready.</h1><p>Just a moment.</p></div>; }
