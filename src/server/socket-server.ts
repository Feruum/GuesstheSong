import { app } from "./api";
import { authorizeRoomSocket, getRoomSocketHub, type SocketData } from "./room-sockets";

const hub = getRoomSocketHub();
await hub.start();
const opening = new WeakMap<object, Promise<void>>();
const server = Bun.serve<SocketData>({
  port: Number(process.env.SOCKET_PORT || 3001), hostname: "127.0.0.1", idleTimeout: 60,
  async fetch(request, server) {
    if (new URL(request.url).pathname !== "/api/ws") return app.fetch(request);
    const data = await authorizeRoomSocket(request);
    if (data instanceof Response) return data;
    return server.upgrade(request, { data }) ? undefined : new Response("Upgrade required", { status: 426 });
  },
  websocket: {
    maxPayloadLength: 65536,
    open(socket) { const ready = hub.open(socket); opening.set(socket, ready); void ready.catch(() => socket.close(1011, "Room unavailable")); },
    async message(socket, message) { await opening.get(socket)?.catch(() => undefined); await hub.message(socket, typeof message === "string" ? message : Buffer.from(message).toString()); },
    async close(socket) { await opening.get(socket)?.catch(() => undefined); await hub.close(socket); },
  },
});
console.log(`Multiplayer server: http://127.0.0.1:${server.port}`);
