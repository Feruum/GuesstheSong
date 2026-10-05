import { notFound } from "next/navigation";
import { RoomView } from "@/components/room-view";
export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) { const { code } = await params; if (!/^[a-z0-9]{6}$/i.test(code)) notFound(); return <RoomView code={code.toUpperCase()} />; }
