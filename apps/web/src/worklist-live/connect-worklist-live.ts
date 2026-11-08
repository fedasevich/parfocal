import { getRoomAccess } from "@parfocal/api-client";
import { RoomClient, type RoomTicket, type SocketLike } from "@parfocal/edge/room-client";
import type { QueryClient } from "@tanstack/react-query";
import { readBuildConfig } from "../config.ts";
import { roomSocketUrl } from "../presence/presence-state.ts";
import { openFakeWorklistSocket } from "./fake-worklist-socket.ts";
import { changesWorklist, isWorklistQuery, userRoom } from "./worklist-events.ts";

const fakeLifetimeSeconds = 300;

async function roomTicket(room: string): Promise<RoomTicket | null> {
  const response = await getRoomAccess(room);
  if (response.status === 200) {
    return { token: response.data.token, lifetimeSeconds: response.data.lifetime_seconds };
  }
  if (response.status === 403 || response.status === 404) return null;
  throw new Error(`Room access answered ${response.status}`);
}

export function connectWorklistLive(queryClient: QueryClient, me: string): () => void {
  const fake = import.meta.env.DEV && readBuildConfig().fakeApi !== "off";
  const room = userRoom(me);
  const refresh = () =>
    void queryClient.invalidateQueries({ predicate: (query) => isWorklistQuery(query.queryKey) });
  const client = new RoomClient({
    url: roomSocketUrl(room, window.location),
    ticket: fake
      ? () => Promise.resolve({ token: me, lifetimeSeconds: fakeLifetimeSeconds })
      : () => roomTicket(room),
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
