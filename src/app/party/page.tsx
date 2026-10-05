import type { Metadata } from "next";
import { RoomEntrance } from "@/components/room-settings";
export const metadata: Metadata = { title: "Play with friends", description: "Invite up to 24 friends and guess the same songs in a private music party." };
export default async function PartyPage({ searchParams }: { searchParams: Promise<{ pack?: string }> }) { const { pack } = await searchParams; return <div className="page-container max-w-[1120px]" data-testid="party-page"><span className="eyebrow mb-4">Good music. Better company.</span><h1 className="page-title">Play it together.</h1><p className="mb-9 mt-4 text-lg text-muted">Invite your friends. Guess the same songs. Find out who knows it first.</p><RoomEntrance mode="party" packId={pack} /></div>; }
