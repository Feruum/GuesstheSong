"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { roomCommandSchema } from "@/shared/contracts";
import { api, ApiError, json, type LiveRoom } from "@/lib/api";
import { useGuest } from "./use-guest";

export type RoomCommandInput = z.output<typeof roomCommandSchema>;
export type RoomAction = Omit<RoomCommandInput, "id">;
export function useRoom(code: string) {
  const guest = useGuest(); const client = useQueryClient(); const [connection, setConnection] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const socket = useRef<WebSocket | null>(null); const pending = useRef(new Map<string, (room: LiveRoom) => void>()); const lastCommand = useRef<RoomCommandInput | null>(null);
  const key = ["room", code];
  const update = useCallback((room: LiveRoom) => client.setQueryData<{ room: LiveRoom }>(["room", code], old => old && old.room.revision > room.revision ? old : { room }), [client, code]);
  const query = useQuery({ queryKey: key, queryFn: () => api<{ room: LiveRoom }>(`/rooms/${code}`), enabled: !!guest.data, retry: (count, error) => !(error instanceof ApiError && [403, 410].includes(error.status)) && count < 1, structuralSharing: (oldData, newData) => { const old = oldData as { room: LiveRoom } | undefined; const next = newData as { room: LiveRoom }; return old && old.room.revision > next.room.revision ? old : next; }, refetchInterval: query => query.state.error instanceof ApiError && [403, 410].includes(query.state.error.status) ? false : connection === "connected" ? 30_000 : 3000 });
  const joined = !!query.data?.room && !(query.error instanceof ApiError && [403, 410].includes(query.error.status));
  useEffect(() => {
    if (!joined) return;
    let stopped = false; let attempts = 0; let timer: ReturnType<typeof setTimeout> | undefined; let current: WebSocket | null = null;
    function connect() {
      if (stopped) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:"; const next = new WebSocket(`${protocol}//${location.host}/api/ws?room=${code}`); current = next; socket.current = next;
      next.onopen = () => { attempts = 0; setConnection("connected"); void client.invalidateQueries({ queryKey: ["room", code] }); };
      next.onmessage = event => {
        try { const message = JSON.parse(event.data) as { type: string; room?: LiveRoom; commandId?: string };
          if (message.room) { update(message.room); if (message.commandId) { pending.current.get(message.commandId)?.(message.room); pending.current.delete(message.commandId); } }
          if (message.type === "rotate") next.close(1000, "Resynchronizing");
        } catch { /* The next snapshot or HTTP refresh recovers malformed events. */ }
      };
      next.onclose = () => { if (socket.current === next) socket.current = null; if (stopped) return; setConnection("reconnecting"); timer = setTimeout(connect, Math.min(8000, 500 * 2 ** attempts++)); };
      next.onerror = () => next.close();
    }
    const online = () => { void client.invalidateQueries({ queryKey: ["room", code] }); if (!current || current.readyState === WebSocket.CLOSED) { clearTimeout(timer); connect(); } };
    const visible = () => { if (document.visibilityState === "visible") online(); };
    connect(); const ping = setInterval(() => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(json({ type: "ping" })); else void api<{ room: LiveRoom }>(`/rooms/${code}/commands`, { method: "POST", body: json({ id: crypto.randomUUID(), kind: "heartbeat" }) }).then(({ room }) => update(room)).catch(() => undefined); }, 10_000);
    window.addEventListener("online", online); document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearTimeout(timer); clearInterval(ping); window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visible); current?.close(1000, "Leaving page"); socket.current = null; };
  }, [code, joined, client, update]);
  const mutation = useMutation({ mutationFn: async (command: RoomCommandInput) => {
    if (command.kind !== "join" && socket.current?.readyState === WebSocket.OPEN) {
      const active = socket.current;
      const acknowledged = await new Promise<LiveRoom | null>(resolve => { const timeout = setTimeout(() => { pending.current.delete(command.id); resolve(null); }, 1800); pending.current.set(command.id, room => { clearTimeout(timeout); resolve(room); }); active.send(json(command)); });
      if (acknowledged) return { room: acknowledged };
    }
    return api<{ room: LiveRoom }>(`/rooms/${code}/commands`, { method: "POST", body: json(command) });
  }, onSuccess: ({ room }) => { update(room); lastCommand.current = null; if (room.status === "complete") void client.invalidateQueries({ queryKey: ["stats"] }); } });
  function send(action: RoomAction) { if (mutation.isPending) return; const old = lastCommand.current; const same = old && old.kind === action.kind && old.trackId === action.trackId && old.ready === action.ready && json(old.settings) === json(action.settings); const command = same ? old : { ...action, id: crypto.randomUUID() }; lastCommand.current = command; mutation.mutate(command); }
  const retry = () => { if (lastCommand.current) mutation.mutate(lastCommand.current); };
  return { ...query, guest, room: query.data?.room, connection, send, retry, mutation };
}
