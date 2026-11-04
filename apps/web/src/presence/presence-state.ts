import type { RoomMessage } from "@parfocal/edge/room-client";

export const PRESENCE_JOINED = "presence.joined";
export const PRESENCE_LEFT = "presence.left";

export function nextPresence(
  present: ReadonlySet<string>,
  event: RoomMessage,
  me: string,
): ReadonlySet<string> {
  const user = event.ids["user"];
  if (user === undefined || user === me) return present;
  if (event.kind === PRESENCE_JOINED && !present.has(user)) return new Set([...present, user]);
  if (event.kind === PRESENCE_LEFT && present.has(user)) {
    return new Set([...present].filter((id) => id !== user));
  }
  return present;
}

export function roomSocketUrl(room: string, location: { protocol: string; host: string }): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/rt/${room}`;
}
