import type { Metadata } from "next";
import { SoloSession } from "@/components/game-player";
export const metadata: Metadata = { title: "Daily challenge", description: "One song. Six guesses. Play today's shared music challenge and keep your streak." };
export default function DailyPage() { return <SoloSession daily />; }
