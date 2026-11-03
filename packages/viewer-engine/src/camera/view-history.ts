import type { ViewerEngine } from "../engine/types.ts";
import { type Camera, screenScale } from "./camera.ts";

export const viewHistoryLimit = 50;

export const viewRestMs = 300;

export const sameViewPixels = 2;

export const sameViewOctaves = 0.01;

export interface ViewHistoryEntries<View = Camera> {
  readonly back: readonly View[];
  readonly forward: readonly View[];
  readonly rest: View | null;
}

export interface ViewHistory<View = Camera> {
  readonly settle: (view: View) => void;
  readonly back: (current?: View) => View | null;
  readonly forward: (current?: View) => View | null;
  readonly clear: () => void;
  readonly entries: () => ViewHistoryEntries<View>;
}

export function sameView(a: Camera, b: Camera): boolean {
  if (Math.abs(a.zoom - b.zoom) > sameViewOctaves) return false;
  const scale = screenScale(a.zoom >= b.zoom ? a : b);
  return Math.hypot((a.x - b.x) * scale, (a.y - b.y) * scale) <= sameViewPixels;
}

export function createViewHistory(limit?: number): ViewHistory;
export function createViewHistory<View>(
  limit: number,
  same: (a: View, b: View) => boolean,
): ViewHistory<View>;
export function createViewHistory<View>(
  limit = viewHistoryLimit,
  same: (a: View, b: View) => boolean = sameView as unknown as (a: View, b: View) => boolean,
): ViewHistory<View> {
  const backStack: View[] = [];
  const forwardStack: View[] = [];
  let rest: View | null = null;

  const settle = (camera: View) => {
    if (rest !== null && same(rest, camera)) return;
    if (rest !== null) {
      backStack.push(rest);
      if (backStack.length > limit) backStack.splice(0, backStack.length - limit);
      forwardStack.length = 0;
    }
    rest = camera;
  };

  const step = (from: View[], to: View[], current: View | undefined) => {
    if (current !== undefined) settle(current);
    const target = from.pop();
    if (target === undefined) return null;
    if (rest !== null) to.push(rest);
    rest = target;
    return target;
  };

  return {
    settle,
    back: (current) => step(backStack, forwardStack, current),
    forward: (current) => step(forwardStack, backStack, current),
    clear: () => {
      backStack.length = 0;
      forwardStack.length = 0;
      rest = null;
    },
    entries: () => ({ back: [...backStack], forward: [...forwardStack], rest }),
  };
}

export interface RestTimers {
  readonly set: (callback: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const globalTimers: RestTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type HistoryEngine = Pick<
  ViewerEngine,
  "getCamera" | "getMotion" | "getSlide" | "flyTo" | "subscribeCamera" | "on"
>;

export interface BoundViewHistory {
  readonly history: ViewHistory;
  readonly back: () => boolean;
  readonly forward: () => boolean;
  readonly dispose: () => void;
}

export function bindViewHistory(
  engine: HistoryEngine,
  options: { readonly timers?: RestTimers; readonly restMs?: number; readonly limit?: number } = {},
): BoundViewHistory {
  const timers = options.timers ?? globalTimers;
  const restMs = options.restMs ?? viewRestMs;
  const history = createViewHistory(options.limit);
  let timer: unknown = null;
  let navigating = 0;

  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const check = () => {
    timer = null;
    if (engine.getSlide() === null) return;
    if (engine.getMotion() !== "idle") {
      schedule();
      return;
    }
    if (navigating === 0) history.settle(engine.getCamera());
  };
  const schedule = () => {
    cancel();
    timer = timers.set(check, restMs);
  };

  const stopCamera = engine.subscribeCamera(schedule);
  const stopSlide = engine.on("slide", () => {
    navigating = 0;
    history.clear();
    schedule();
  });
  if (engine.getSlide() !== null) schedule();

  const go = (move: (current?: Camera) => Camera | null) => {
    if (engine.getSlide() === null) return false;
    cancel();
    const target = move(navigating === 0 ? engine.getCamera() : undefined);
    if (target === null) return false;
    navigating += 1;
    const slide = engine.getSlide();
    void engine.flyTo(target).finally(() => {
      if (navigating > 0) navigating -= 1;
      if (engine.getSlide() === slide) schedule();
    });
    return true;
  };

  return {
    history,
    back: () => go(history.back),
    forward: () => go(history.forward),
    dispose: () => {
      cancel();
      stopCamera();
      stopSlide();
    },
  };
}
