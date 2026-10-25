export type HiddenMode = "hold" | "drop";

export interface ProbeCounts {
  readonly frameRequests: number;
  readonly frameCallbacks: number;
  readonly timerCallbacks: number;
}

export interface FrameProbe {
  counts(): ProbeCounts;
  hide(mode: HiddenMode): void;
  show(): void;
  starve(on: boolean): void;
  hidden(): boolean;
  visibilityListeners(): number;
}

declare global {
  interface Window {
    frameProbe: FrameProbe;
  }
}

const hiddenTimerFloorMs = 1000;

const nativeFrame = window.requestAnimationFrame.bind(window);
const nativeCancelFrame = window.cancelAnimationFrame.bind(window);
const nativeTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);

let hidden = false;
let starved = false;
let mode: HiddenMode = "drop";
let frameRequests = 0;
let frameCallbacks = 0;
let timerCallbacks = 0;
let nextFakeHandle = 1_000_000_000;
const held = new Map<number, FrameRequestCallback>();

const suspended = (): boolean => hidden || starved;

window.requestAnimationFrame = (callback) => {
  frameRequests++;
  if (suspended() && mode === "drop") return nextFakeHandle++;
  const handle: number = nativeFrame((time) => {
    if (suspended()) {
      if (mode === "hold") held.set(handle, callback);
      return;
    }
    frameCallbacks++;
    callback(time);
  });
  return handle;
};

window.cancelAnimationFrame = (handle) => {
  held.delete(handle);
  nativeCancelFrame(handle);
};

interface ShimTimer {
  readonly handler: TimerHandler;
  readonly args: readonly unknown[];
  readonly repeat: number | null;
  due: number;
  native: number;
}

const timers = new Map<number, ShimTimer>();
let nextTimerId = 1;

function armTimer(id: number, timer: ShimTimer): void {
  const remaining = Math.max(timer.due - performance.now(), 0);
  const delay = hidden ? Math.max(remaining, hiddenTimerFloorMs) : remaining;
  timer.native = nativeTimeout(() => {
    timerCallbacks++;
    if (timer.repeat === null) timers.delete(id);
    else {
      timer.due = performance.now() + timer.repeat;
      armTimer(id, timer);
    }
    if (typeof timer.handler === "function") Reflect.apply(timer.handler, undefined, timer.args);
  }, delay);
}

function addTimer(
  handler: TimerHandler,
  delay: number | undefined,
  args: unknown[],
  repeat: boolean,
) {
  const id = nextTimerId++;
  const interval = Math.max(delay ?? 0, 0);
  const timer: ShimTimer = {
    handler,
    args,
    repeat: repeat ? interval : null,
    due: performance.now() + interval,
    native: 0,
  };
  timers.set(id, timer);
  armTimer(id, timer);
  return id;
}

function removeTimer(id: unknown): void {
  if (typeof id !== "number") return;
  const timer = timers.get(id);
  if (timer === undefined) return;
  nativeClearTimeout(timer.native);
  timers.delete(id);
}

function rearmTimers(): void {
  for (const [id, timer] of timers) {
    nativeClearTimeout(timer.native);
    armTimer(id, timer);
  }
}

window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
  addTimer(handler, delay, args, false)) as typeof window.setTimeout;
window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
  addTimer(handler, delay, args, true)) as typeof window.setInterval;
window.clearTimeout = removeTimer;
window.clearInterval = removeTimer;

Object.defineProperty(document, "visibilityState", {
  configurable: true,
  get: () => (hidden ? "hidden" : "visible"),
});
Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

const visibilityListeners = new Set<EventListenerOrEventListenerObject>();
const nativeAddListener = document.addEventListener.bind(document);
const nativeRemoveListener = document.removeEventListener.bind(document);

document.addEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | AddEventListenerOptions,
) => {
  if (type === "visibilitychange" && listener) visibilityListeners.add(listener);
  if (listener) nativeAddListener(type, listener, options);
}) as typeof document.addEventListener;

document.removeEventListener = ((
  type: string,
  listener: EventListenerOrEventListenerObject | null,
  options?: boolean | EventListenerOptions,
) => {
  if (type === "visibilitychange" && listener) visibilityListeners.delete(listener);
  if (listener) nativeRemoveListener(type, listener, options);
}) as typeof document.removeEventListener;

function announce(): void {
  document.dispatchEvent(new Event("visibilitychange"));
}

function release(): void {
  const callbacks = [...held.values()];
  held.clear();
  if (callbacks.length === 0) return;
  nativeFrame((time) => {
    frameCallbacks += callbacks.length;
    for (const callback of callbacks) callback(time);
  });
}

window.frameProbe = {
  counts: () => ({ frameRequests, frameCallbacks, timerCallbacks }),
  hide: (next) => {
    mode = next;
    hidden = true;
    rearmTimers();
    announce();
  },
  show: () => {
    hidden = false;
    rearmTimers();
    announce();
    release();
  },
  starve: (on) => {
    mode = "drop";
    starved = on;
    if (!on) release();
  },
  hidden: () => hidden,
  visibilityListeners: () => visibilityListeners.size,
};
