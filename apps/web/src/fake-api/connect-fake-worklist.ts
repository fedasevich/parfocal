import { arriveFakeWorklistTask } from "@parfocal/api-client/fake";
import { RoomClient } from "@parfocal/edge/room-client";
import type { QueryClient } from "@tanstack/react-query";
import { roomSocketUrl } from "../presence/presence-state.ts";
import { openFakeWorklistSocket } from "../worklist-live/fake-worklist-socket.ts";
import { changesWorklist, isWorklistQuery, userRoom } from "../worklist-live/worklist-events.ts";

const fakeLifetimeSeconds = 300;

export function connectFakeWorklist(queryClient: QueryClient, me: string): () => void {
  const room = userRoom(me);
  const refresh = () =>
    void queryClient.invalidateQueries({ predicate: (query) => isWorklistQuery(query.queryKey) });
  const client = new RoomClient({
    url: roomSocketUrl(room, window.location),
    ticket: () => Promise.resolve({ token: me, lifetimeSeconds: fakeLifetimeSeconds }),
    open: openFakeWorklistSocket,
    refetch: refresh,
    onEvent: (event) => {
      if (!changesWorklist(event)) return;
      arriveFakeWorklistTask();
      refresh();
    },
  });
  client.start();
  return () => client.stop();
}
