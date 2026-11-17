import { RoomClient, type SocketLike } from "@parfocal/edge/room-client";
import type { QueryClient } from "@tanstack/react-query";
import { readBuildConfig } from "../config.ts";
import { roomSocketUrl } from "../presence/presence-state.ts";
import { roomAccess } from "../presence/room-access.ts";
import { openFakeWorklistSocket } from "./fake-worklist-socket.ts";
import { changesWorklist, isWorklistQuery, userRoom } from "./worklist-events.ts";

const fakeLifetimeSeconds = 300;

export function connectWorklistLive(queryClient: QueryClient, me: string): () => void {
  const fake =
    import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on" && readBuildConfig().fakeApi !== "off";
  const room = userRoom(me);
  const refresh = () =>
    void queryClient.invalidateQueries({ predicate: (query) => isWorklistQuery(query.queryKey) });
  const client = new RoomClient({
    url: roomSocketUrl(room, window.location),
    ticket: fake
      ? () => Promise.resolve({ token: me, lifetimeSeconds: fakeLifetimeSeconds })
      : () => roomAccess.ticket(room),
    open: fake
      ? openFakeWorklistSocket
      : (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    refetch: refresh,
    onEvent: (event) => {
      if (!changesWorklist(event)) return;
      if (!fake) {
        refresh();
        return;
      }
      void import("@parfocal/api-client/fake").then(({ arriveFakeWorklistTask }) => {
        arriveFakeWorklistTask();
        refresh();
      });
    },
  });
  client.start();
  return () => client.stop();
}
