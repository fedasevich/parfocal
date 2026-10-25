import type { GuardedFrames } from "../engine/guarded-frames.ts";
import type { Cancel, TabVisibility } from "../engine/scheduling.ts";

export type DeckFrameCallback = (time: number, frame?: unknown) => void;

export interface DeckFrameProvider {
  requestAnimationFrame(callback: DeckFrameCallback): number;
  cancelAnimationFrame(handle: number): void;
}

export type WakeSource = "change" | "resize" | "read" | "poll";

export interface DeckSleepStats {
  readonly frames: number;
  readonly sleeps: number;
  readonly wakes: Readonly<Record<WakeSource, number>>;
  readonly rescues: number;
}

export interface DeckSleep {
  readonly provider: DeckFrameProvider;
  readonly wake: (source: WakeSource) => void;
  readonly asleep: () => boolean;
  readonly stats: () => DeckSleepStats;
  readonly destroy: () => void;
}

export interface DeckSleepOptions {
  readonly frames: GuardedFrames;
  readonly visibility: TabVisibility;
  readonly settled: () => boolean;
  readonly now: () => number;
  readonly quietFrames?: number;
}

export const defaultQuietFrames = 3;

interface Request {
  readonly id: number;
  readonly callback: DeckFrameCallback;
}

export function createDeckSleep(options: DeckSleepOptions): DeckSleep {
  const { frames, visibility, settled, now } = options;
  const quietFrames = options.quietFrames ?? defaultQuietFrames;
  const wakes: Record<WakeSource, number> = { change: 0, resize: 0, read: 0, poll: 0 };
  const counts = { frames: 0, sleeps: 0, rescues: 0 };
  let nextId = 1;
  let current: Request | null = null;
  let handle: number | null = null;
  let parked = false;
  let asleep = false;
  let quiet = 0;
  let drawn = false;
  let destroyed = false;

  const schedule = (request: Request) => {
    handle = frames.request(() => {
      handle = null;
      if (current !== request) return;
      counts.frames += 1;
      drawn = true;
      request.callback(now());
    });
  };

  const unschedule = () => {
    if (handle !== null) frames.cancel(handle);
    handle = null;
  };

  const release = () => {
    if (!parked || current === null || destroyed) return;
    parked = false;
    asleep = false;
    schedule(current);
  };

  const park = (sleeping: boolean) => {
    unschedule();
    parked = true;
    if (sleeping && !asleep) counts.sleeps += 1;
    asleep = sleeping;
  };

  const visibilityChanged = () => {
    if (destroyed) return;
    if (visibility.hidden()) {
      if (current !== null && !parked) park(false);
      if (!settled()) release();
      return;
    }
    quiet = 0;
    if (parked) release();
    else frames.restart();
  };

  const stopListening: Cancel = visibility.subscribe(visibilityChanged);

  const provider: DeckFrameProvider = {
    requestAnimationFrame: (callback) => {
      const request: Request = { id: nextId++, callback };
      current = request;
      parked = false;
      asleep = false;
      if (destroyed) return request.id;
      if (visibility.hidden()) {
        park(false);
        return request.id;
      }
      quiet = drawn && settled() ? quiet + 1 : 0;
      drawn = false;
      if (quiet >= quietFrames) {
        park(true);
        return request.id;
      }
      schedule(request);
      return request.id;
    },
    cancelAnimationFrame: (id) => {
      if (current?.id !== id) return;
      unschedule();
      current = null;
      parked = false;
      asleep = false;
    },
  };

  return {
    provider,
    wake: (source) => {
      if (destroyed) return;
      wakes[source] += 1;
      quiet = 0;
      if (!parked) return;
      if (source === "poll" && asleep) counts.rescues += 1;
      release();
    },
    asleep: () => asleep,
    stats: () => ({ ...counts, wakes: { ...wakes } }),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      stopListening();
      unschedule();
      current = null;
      parked = false;
      asleep = false;
    },
  };
}
