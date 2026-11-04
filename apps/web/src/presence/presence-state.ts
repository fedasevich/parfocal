import type { RoomMessage } from "@parfocal/edge/room-client";

export const PRESENCE_JOINED = "presence.joined";
export const PRESENCE_LEFT = "presence.left";

export type Sighting = { readonly user: string; readonly slide: string | undefined };

const keyOf = ({ user, slide }: Sighting) => `${slide ?? ""}/${user}`;

export function nextPresence(
  present: ReadonlyMap<string, Sighting>,
  event: RoomMessage,
  me: string,
): ReadonlyMap<string, Sighting> {
  const user = event.ids["user"];
  if (user === undefined || user === me) return present;
  const sighting: Sighting = { user, slide: event.ids["slide"] };
  const key = keyOf(sighting);
  if (event.kind === PRESENCE_JOINED && !present.has(key)) {
    return new Map([...present, [key, sighting]]);
  }
  if (event.kind === PRESENCE_LEFT && present.has(key)) {
    return new Map([...present].filter(([known]) => known !== key));
  }
  return present;
}

export function viewersOf(present: ReadonlyMap<string, Sighting>, slide?: string): string[] {
  return [...present.values()]
    .filter((sighting) => sighting.slide === slide)
    .map((sighting) => sighting.user);
}

export function roomSocketUrl(room: string, location: { protocol: string; host: string }): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}/rt/${room}`;
}
