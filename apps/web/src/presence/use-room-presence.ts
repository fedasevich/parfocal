import { getRoomAccess } from "@parfocal/api-client";
import { RoomClient, type RoomTicket, type SocketLike } from "@parfocal/edge/room-client";
import { useEffect, useState } from "react";
import { readBuildConfig } from "../config.ts";
import { openFakeRoomSocket } from "./fake-room-socket.ts";
import { nextPresence, roomSocketUrl, type Sighting } from "./presence-state.ts";

const fake = readBuildConfig().fakeApi !== "off";
const fakeLifetimeSeconds = 300;
const nobody: ReadonlyMap<string, Sighting> = new Map();

async function roomTicket(room: string): Promise<RoomTicket | null> {
  const response = await getRoomAccess(room);
  if (response.status === 200) {
    return { token: response.data.token, lifetimeSeconds: response.data.lifetime_seconds };
  }
  if (response.status === 403 || response.status === 404) return null;
  throw new Error(`Room access answered ${response.status}`);
}

export function useRoomPresence(
  room: string | null,
  me: string | undefined,
): ReadonlyMap<string, Sighting> {
  const [present, setPresent] = useState<ReadonlyMap<string, Sighting>>(nobody);
  useEffect(() => {
    setPresent(nobody);
    if (room === null || me === undefined) return;
    const client = new RoomClient({
      url: roomSocketUrl(room, window.location),
      ticket: fake
        ? () => Promise.resolve({ token: me, lifetimeSeconds: fakeLifetimeSeconds })
        : () => roomTicket(room),
      open: fake
        ? openFakeRoomSocket
        : (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      refetch: () => setPresent(nobody),
      onEvent: (event) => setPresent((previous) => nextPresence(previous, event, me)),
    });
    client.start();
    return () => client.stop();
  }, [room, me]);
  return present;
}
