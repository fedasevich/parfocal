import { getRoomAccess } from "@parfocal/api-client";
import {
  RoomClient,
  type RoomMessage,
  type RoomTicket,
  type SocketLike,
} from "@parfocal/edge/room-client";
import { useEffect, useRef, useState } from "react";
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

export function useRoomEvents(
  room: string | null,
  me: string | undefined,
  onEvent: (event: RoomMessage) => void,
  onRefetch: () => void = () => undefined,
): void {
  const handlers = useRef({ onEvent, onRefetch });
  handlers.current = { onEvent, onRefetch };
  useEffect(() => {
    if (room === null || me === undefined) return;
    const client = new RoomClient({
      url: roomSocketUrl(room, window.location),
      ticket: fake
        ? () => Promise.resolve({ token: me, lifetimeSeconds: fakeLifetimeSeconds })
        : () => roomTicket(room),
      open: fake
        ? openFakeRoomSocket
        : (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
      refetch: () => handlers.current.onRefetch(),
      onEvent: (event) => handlers.current.onEvent(event),
    });
    client.start();
    return () => client.stop();
  }, [room, me]);
}

export function useRoomPresence(
  room: string | null,
  me: string | undefined,
): ReadonlyMap<string, Sighting> {
  const [held, setHeld] = useState<{ room: string | null; map: ReadonlyMap<string, Sighting> }>({
    room,
    map: nobody,
  });
  useRoomEvents(
    room,
    me,
    (event) =>
      setHeld((previous) => ({
        room,
        map: nextPresence(previous.room === room ? previous.map : nobody, event, me ?? ""),
      })),
    () => setHeld({ room, map: nobody }),
  );
  const present = held.room === room ? held.map : nobody;
  return present;
}
