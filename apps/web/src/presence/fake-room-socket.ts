import type { SocketLike } from "@parfocal/edge/room-client";
import { PRESENCE_JOINED, PRESENCE_LEFT } from "./presence-state.ts";

type Signal = { type: "hello" | "here" | "bye"; user: string };

export function openFakeRoomSocket(url: string, protocols: string[]): SocketLike {
  const user = protocols[1] ?? "";
  const channel = new BroadcastChannel(`parfocal-fake-room:${new URL(url).pathname}`);
  let open = true;
  const deliver = (kind: string, other: string) =>
    socket.onmessage?.({ data: JSON.stringify({ type: "event", kind, ids: { user: other } }) });
  const leave = () => {
    if (!open) return;
    open = false;
    channel.postMessage({ type: "bye", user } satisfies Signal);
    channel.close();
    window.removeEventListener("pagehide", leave);
  };
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: () => undefined,
    close: () => {
      leave();
      socket.onclose?.({ code: 1000 });
    },
  };
  channel.onmessage = ({ data }: MessageEvent<Signal>) => {
    if (!open || data.user === user) return;
    if (data.type === "bye") {
      deliver(PRESENCE_LEFT, data.user);
      return;
    }
    deliver(PRESENCE_JOINED, data.user);
    if (data.type === "hello") channel.postMessage({ type: "here", user } satisfies Signal);
  };
  window.addEventListener("pagehide", leave);
  setTimeout(() => {
    if (!open) return;
    socket.onopen?.();
    channel.postMessage({ type: "hello", user } satisfies Signal);
  }, 0);
  return socket;
}
