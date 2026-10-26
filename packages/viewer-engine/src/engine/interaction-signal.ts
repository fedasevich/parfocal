import type { Cancel, TimerScheduler } from "./scheduling.ts";
import { systemTimers } from "./scheduling.ts";
import type { Clock, Unsubscribe } from "./types.ts";

export const defaultRestMs = 200;

export type MovingListener = (moving: boolean) => void;

export interface InteractionSignal {
  readonly moving: () => boolean;
  readonly pulse: () => void;
  readonly hold: () => Cancel;
  readonly subscribe: (listener: MovingListener) => Unsubscribe;
  readonly whenRested: (abort?: AbortSignal) => Promise<void>;
  readonly dispose: () => void;
}

export interface InteractionSignalOptions {
  readonly now?: Clock;
  readonly timers?: TimerScheduler | null;
  readonly restMs?: number;
}

const systemNow: Clock = () => performance.now();

export function createInteractionSignal(options: InteractionSignalOptions = {}): InteractionSignal {
  const now = options.now ?? systemNow;
  const timers = options.timers === undefined ? systemTimers : options.timers;
  const restMs = options.restMs ?? defaultRestMs;

  const listeners = new Set<MovingListener>();
  let holds = 0;
  let lastActivity = Number.NEGATIVE_INFINITY;
  let announced = false;
  let cancelTimer: Cancel | null = null;
  let disposed = false;

  const movingNow = (): boolean => !disposed && (holds > 0 || now() - lastActivity < restMs);

  const announce = (moving: boolean) => {
    if (announced === moving) return;
    announced = moving;
    for (const listener of [...listeners]) listener(moving);
  };

  const check = () => {
    cancelTimer = null;
    if (holds > 0) return;
    if (movingNow()) {
      arm();
      return;
    }
    announce(false);
  };

  const arm = () => {
    if (timers === null || cancelTimer !== null || holds > 0 || disposed) return;
    if (listeners.size === 0) return;
    cancelTimer = timers.after(check, Math.max(0, restMs - (now() - lastActivity)));
  };

  const pulse = () => {
    if (disposed) return;
    lastActivity = now();
    announce(true);
    arm();
  };

  const hold = (): Cancel => {
    if (disposed) return () => {};
    holds += 1;
    cancelTimer?.();
    cancelTimer = null;
    announce(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds -= 1;
      if (disposed) return;
      lastActivity = now();
      arm();
    };
  };

  const subscribe = (listener: MovingListener): Unsubscribe => {
    listeners.add(listener);
    if (!movingNow()) announced = false;
    arm();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        cancelTimer?.();
        cancelTimer = null;
      }
    };
  };

  const nextRest = (abort: AbortSignal | undefined): Promise<void> =>
    new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        stop();
        abort?.removeEventListener("abort", onAbort);
        if (error === undefined) resolve();
        else reject(error);
      };
      const onAbort = () =>
        finish(
          abort?.reason instanceof Error ? abort.reason : new Error("Waiting for rest was aborted"),
        );
      const stop = subscribe((moving) => {
        if (!moving) finish();
      });
      if (abort?.aborted) onAbort();
      else abort?.addEventListener("abort", onAbort);
    });

  const whenRested = async (abort?: AbortSignal): Promise<void> => {
    while (movingNow() && !disposed) {
      if (timers === null) throw new Error("A signal without timers cannot announce rest");
      await nextRest(abort);
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelTimer?.();
    cancelTimer = null;
    holds = 0;
    announce(false);
    listeners.clear();
  };

  return { moving: movingNow, pulse, hold, subscribe, whenRested, dispose };
}
