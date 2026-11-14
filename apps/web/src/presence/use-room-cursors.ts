import type { RoomSignal } from "@parfocal/edge/room-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hearUnlessBlinded, sendUnlessBlinded } from "./blinded.ts";
import { VIEW_FRAME } from "./follow-view.ts";
import { PRESENCE_LEFT } from "./presence-state.ts";
import { heardCursorOf, type ShownCursor, withCursor } from "./shared-cursor.ts";
import { useRoomEvents } from "./use-room-presence.ts";

const none: readonly ShownCursor[] = [];

export type RoomCursors = {
  readonly cursors: readonly ShownCursor[];
  readonly send: (signal: RoomSignal) => boolean;
};

export function useRoomCursors(
  slideId: string,
  me: string | undefined,
  blinded: boolean,
): RoomCursors {
  const [cursors, setCursors] = useState(none);
  const blind = useRef(blinded);
  blind.current = blinded;
  const isBlinded = useCallback(() => blind.current, []);
  useEffect(() => {
    if (blinded) setCursors(none);
  }, [blinded]);
  const drop = (user: string) => setCursors((known) => withCursor(known, { user, gone: true }));
  const send = useRoomEvents(
    `slide:${slideId}`,
    me,
    (event) => {
      const user = event.ids["user"];
      if (event.kind === PRESENCE_LEFT && user !== undefined) drop(user);
    },
    () => setCursors(none),
    hearUnlessBlinded(isBlinded, (signal) => {
      const heard = heardCursorOf(signal, me ?? "");
      const user = signal["user"];
      const stopped = signal.type === VIEW_FRAME && signal["stop"] === true;
      if (heard !== null) setCursors((known) => withCursor(known, heard));
      else if (stopped && typeof user === "string") drop(user);
    }),
  );
  const guarded = useMemo(() => sendUnlessBlinded(isBlinded, send), [isBlinded, send]);
  return { cursors: blinded ? none : cursors, send: guarded };
}
