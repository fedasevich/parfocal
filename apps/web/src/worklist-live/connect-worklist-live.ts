import { RoomClient, type SocketLike } from "@parfocal/edge/room-client";
import type { QueryClient } from "@tanstack/react-query";
import { readBuildConfig } from "../config.ts";
import { roomSocketUrl } from "../presence/presence-state.ts";
import { roomAccess } from "../presence/room-access.ts";
import { changesWorklist, isWorklistQuery, userRoom } from "./worklist-events.ts";

export function connectWorklistLive(queryClient: QueryClient, me: string): () => void {
  const fake =
    import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on" && readBuildConfig().fakeApi !== "off";
  if (fake) {
    let stopFake: (() => void) | undefined;
    let stopped = false;
    void import("../fake-api/connect-fake-worklist.ts").then(({ connectFakeWorklist }) => {
      if (!stopped) stopFake = connectFakeWorklist(queryClient, me);
    });
    return () => {
      stopped = true;
      stopFake?.();
    };
  }
  const room = userRoom(me);
  const refresh = () =>
    void queryClient.invalidateQueries({ predicate: (query) => isWorklistQuery(query.queryKey) });
  const client = new RoomClient({
    url: roomSocketUrl(room, window.location),
    ticket: () => roomAccess.ticket(room),
    open: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
    refetch: refresh,
    onEvent: (event) => {
      if (changesWorklist(event)) refresh();
    },
  });
  client.start();
  return () => client.stop();
}
