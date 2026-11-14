import type { SocketLike } from "@parfocal/edge/room-client";
import { PRESENCE_JOINED, PRESENCE_LEFT } from "./presence-state.ts";

type Signal =
  | { type: "hello" | "here" | "bye"; user: string; room: string }
  | { type: "relay"; user: string; room: string; frame: Record<string, unknown> };

const relayed = new Set(["view", "cursor"]);

const slideRoom = "slide:";
const taskRoom = "task:";
const layerChannel = "parfocal-fake-layer";
const layerChanged = "layer.object-changed";

type LayerSignal = { task: string; slide: string; annotation: string; actor: string };
const projectRoom = "project:";

export function openFakeRoomSocket(url: string, protocols: string[]): SocketLike {
  const user = protocols[1] ?? "";
  const room = decodeURIComponent(new URL(url).pathname.replace(/^\/rt\//, ""));
  const watchesProject = room.startsWith(projectRoom);
  const channel = new BroadcastChannel("parfocal-fake-rooms");
  let open = true;
  const deliver = (kind: string, ids: Record<string, string>) =>
    socket.onmessage?.({ data: JSON.stringify({ type: "event", kind, ids }) });
  const post = (type: "hello" | "here" | "bye") =>
    channel.postMessage({ type, user, room } satisfies Signal);
  const relayFrame = (text: string) => {
    const frame = JSON.parse(text) as Record<string, unknown>;
    if (!open || !relayed.has(String(frame["type"])) || !room.startsWith(slideRoom)) return;
    channel.postMessage({ type: "relay", user, room, frame } satisfies Signal);
  };
  const leave = () => {
    if (!open) return;
    open = false;
    post("bye");
    channel.close();
    layer?.close();
    window.removeEventListener("pagehide", leave);
  };
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: relayFrame,
    close: () => {
      leave();
      socket.onclose?.({ code: 1000 });
    },
  };
  channel.onmessage = ({ data }: MessageEvent<Signal>) => {
    if (!open) return;
    if (data.type === "relay") {
      if (data.room !== room || data.user === user) return;
      socket.onmessage?.({ data: JSON.stringify({ ...data.frame, user: data.user }) });
      return;
    }
    const kind = data.type === "bye" ? PRESENCE_LEFT : PRESENCE_JOINED;
    if (watchesProject && data.room.startsWith(slideRoom)) {
      deliver(kind, { slide: data.room.slice(slideRoom.length), user: data.user });
      return;
    }
    if (watchesProject) return;
    if (data.type === "hello" && data.room.startsWith(projectRoom)) post("here");
    if (data.room !== room || data.user === user) return;
    deliver(kind, { user: data.user });
    if (data.type === "hello") post("here");
  };
  const layer = room.startsWith(taskRoom) ? new BroadcastChannel(layerChannel) : null;
  if (layer !== null) {
    layer.onmessage = ({ data }: MessageEvent<LayerSignal>) => {
      if (!open || data.actor === user || `${taskRoom}${data.task}` !== room) return;
      setTimeout(() => {
        if (!open) return;
        deliver(layerChanged, { task: data.task, slide: data.slide, annotation: data.annotation });
      }, 0);
    };
  }
  window.addEventListener("pagehide", leave);
  setTimeout(() => {
    if (!open) return;
    socket.onopen?.();
    post("hello");
  }, 0);
  return socket;
}
