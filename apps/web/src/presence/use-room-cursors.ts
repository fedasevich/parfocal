import { useState } from "react";
import { VIEW_FRAME } from "./follow-view.ts";
import { PRESENCE_LEFT } from "./presence-state.ts";
import { heardCursorOf, type ShownCursor, withCursor } from "./shared-cursor.ts";
import { useRoomEvents } from "./use-room-presence.ts";

const none: readonly ShownCursor[] = [];

export function useRoomCursors(slideId: string, me: string | undefined): readonly ShownCursor[] {
  const [cursors, setCursors] = useState(none);
  const drop = (user: string) => setCursors((known) => withCursor(known, { user, gone: true }));
  useRoomEvents(
    `slide:${slideId}`,
    me,
    (event) => {
      const user = event.ids["user"];
      if (event.kind === PRESENCE_LEFT && user !== undefined) drop(user);
    },
    () => setCursors(none),
    (signal) => {
      const heard = heardCursorOf(signal, me ?? "");
      const user = signal["user"];
      const stopped = signal.type === VIEW_FRAME && signal["stop"] === true;
      if (heard !== null) setCursors((known) => withCursor(known, heard));
      else if (stopped && typeof user === "string") drop(user);
    },
  );
  return cursors;
}
