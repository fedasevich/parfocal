import type { SocketLike } from "@parfocal/edge/room-client";
import { WORKLIST_CHANGED } from "./worklist-events.ts";

type Announcement = { user: string };

export const fakeWorklistChannel = "parfocal-fake-worklist";

export function openFakeWorklistSocket(_url: string, protocols: string[]): SocketLike {
  const user = protocols[1] ?? "";
  const channel = new BroadcastChannel(fakeWorklistChannel);
  let open = true;
  const socket: SocketLike = {
    onopen: null,
    onmessage: null,
    onclose: null,
    send: () => undefined,
    close: () => {
      if (!open) return;
      open = false;
      channel.close();
      socket.onclose?.({ code: 1000 });
    },
  };
  channel.onmessage = ({ data }: MessageEvent<Announcement>) => {
    if (!open || data.user !== user) return;
    socket.onmessage?.({
      data: JSON.stringify({ type: "event", kind: WORKLIST_CHANGED, ids: { user } }),
    });
  };
  setTimeout(() => {
    if (open) socket.onopen?.();
  }, 0);
  return socket;
}
