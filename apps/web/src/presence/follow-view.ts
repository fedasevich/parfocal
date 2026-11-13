import type { RoomSignal } from "@parfocal/edge/room-client";

export const VIEW_FRAME = "view";
export const VIEW_SEND_MS = 50;
export const VIEW_HEARTBEAT_MS = 5000;

export type SharedCamera = { readonly x: number; readonly y: number; readonly zoom: number };

export type HeardView =
  | { readonly user: string; readonly stop: true }
  | { readonly user: string; readonly stop: false; readonly camera: SharedCamera };

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function viewFrame(camera: SharedCamera): RoomSignal {
  return { type: VIEW_FRAME, x: camera.x, y: camera.y, zoom: camera.zoom };
}

export const stopFrame: RoomSignal = { type: VIEW_FRAME, stop: true };

export function heardViewOf(signal: RoomSignal, me: string): HeardView | null {
  const { type, user, stop, x, y, zoom } = signal;
  if (type !== VIEW_FRAME || typeof user !== "string" || user === "" || user === me) return null;
  if (stop === true) return { user, stop: true };
  if (!finite(x) || !finite(y) || !finite(zoom)) return null;
  return { user, stop: false, camera: { x, y, zoom } };
}

export function sameCamera(a: SharedCamera, b: SharedCamera): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

export type Throttle = { readonly call: () => void; readonly cancel: () => void };

export function throttle(
  run: () => void,
  ms: number,
  now: () => number = () => performance.now(),
): Throttle {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    timer = null;
    last = now();
    run();
  };
  return {
    call: () => {
      if (timer !== null) return;
      const wait = last + ms - now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
