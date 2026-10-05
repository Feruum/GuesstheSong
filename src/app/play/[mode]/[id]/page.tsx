import { notFound } from "next/navigation";
import { SoloSession } from "@/components/game-player";
export default async function GamePage({ params }: { params: Promise<{ mode: string; id: string }> }) { const { mode, id } = await params; if (!["classic", "daily", "blitz", "chart"].includes(mode) || !/^[0-9a-f-]{36}$/i.test(id)) notFound(); return <SoloSession id={id} expectedMode={mode} />; }
