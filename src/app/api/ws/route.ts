import { experimental_upgradeWebSocket, getDeadline } from "@vercel/functions";
import { authorizeRoomSocket, getRoomSocketHub, type RoomSocket } from "@/server/room-sockets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const data = await authorizeRoomSocket(request);
    if (data instanceof Response) return data;
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Upgrade required", { status: 426 });
    const deadline = getDeadline();
    if (deadline) data.nextRotation = Math.min(data.nextRotation, deadline.getTime() - 15_000);
    const hub = getRoomSocketHub();
    await hub.start();
    return await experimental_upgradeWebSocket(ws => new Promise<void>(resolve => {
      const socket: RoomSocket = { data, get readyState() { return ws.readyState; }, send: message => ws.send(message), close: (code, reason) => ws.close(code, reason) };
      const opening = hub.open(socket);
      ws.on("message", message => { void opening.then(() => hub.message(socket, message.toString())).catch(() => ws.close(1011, "Room unavailable")); });
      ws.on("error", () => ws.close(1011, "Connection interrupted"));
      ws.once("close", () => {
        // Keep the invocation alive until this connection's presence cleanup completes.
        void opening.catch(() => undefined).then(() => hub.close(socket)).catch(() => undefined).finally(resolve);
      });
      void opening.catch(() => ws.close(1011, "Room unavailable"));
    }), { maxPayload: 65536 });
  } catch (error) {
    console.error("Room connection unavailable:", error instanceof Error ? error.message : "failed");
    return new Response("Room connection unavailable. Please try again.", { status: 503 });
  }
}
