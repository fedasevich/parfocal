import type { RoomSignal } from "@parfocal/edge/room-client";
import { throttle } from "./follow-view.ts";

export const CURSOR_FRAME = "cursor";
export const CURSOR_SEND_MS = 50;

export type SlideShare = { readonly x: number; readonly y: number };
export type Extent = { readonly width: number; readonly height: number };
export type FlatPoint = { readonly x: number; readonly y: number };

export type HeardCursor =
  | { readonly user: string; readonly gone: true }
  | { readonly user: string; readonly gone: false; readonly at: SlideShare };

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const shareDigits = 100_000;
const rounded = (value: number) => Math.round(value * shareDigits) / shareDigits;

export function shareOfPoint(point: FlatPoint, slide: Extent): SlideShare {
  return { x: rounded(point.x / slide.width), y: rounded(point.y / slide.height) };
}

export function pointOfShare(share: SlideShare, slide: Extent): FlatPoint {
  return { x: share.x * slide.width, y: share.y * slide.height };
}

export function cursorFrame(at: SlideShare): RoomSignal {
  return { type: CURSOR_FRAME, x: at.x, y: at.y };
}

export const goneFrame: RoomSignal = { type: CURSOR_FRAME, gone: true };

export function heardCursorOf(signal: RoomSignal, me: string): HeardCursor | null {
  const { type, user, gone, x, y } = signal;
  if (type !== CURSOR_FRAME || typeof user !== "string" || user === "" || user === me) return null;
  if (gone === true) return { user, gone: true };
  if (!finite(x) || !finite(y)) return null;
  return { user, gone: false, at: { x, y } };
}

export type ShownCursor = { readonly user: string; readonly at: SlideShare };

export function withCursor(known: readonly ShownCursor[], heard: HeardCursor): ShownCursor[] {
  const others = known.filter((cursor) => cursor.user !== heard.user);
  return heard.gone ? others : [...others, { user: heard.user, at: heard.at }];
}

export type CursorSender = {
  readonly move: (at: SlideShare) => void;
  readonly leave: () => void;
  readonly cancel: () => void;
};

export function cursorSender(
  send: (signal: RoomSignal) => unknown,
  ms: number = CURSOR_SEND_MS,
  now?: () => number,
): CursorSender {
  let latest: SlideShare | null = null;
  let sent: SlideShare | null = null;
  let shown = false;
  const paced = throttle(
    () => {
      if (latest === null) return;
      if (sent !== null && sent.x === latest.x && sent.y === latest.y) return;
      sent = latest;
      shown = true;
      send(cursorFrame(latest));
    },
    ms,
    now,
  );
  return {
    move: (at) => {
      latest = at;
      paced.call();
    },
    leave: () => {
      paced.cancel();
      latest = null;
      sent = null;
      if (!shown) return;
      shown = false;
      send(goneFrame);
    },
    cancel: () => {
      paced.cancel();
      latest = null;
    },
  };
}
