import type { Metadata } from "next";
import { SoloSession } from "@/components/game-player";
export const metadata: Metadata = { title: "Daily challenge", description: "One song from 100 hitmakers. Six guesses. A shared challenge every UTC day, with saved progress and streaks." };
export default function DailyPage() { return <SoloSession daily />; }
