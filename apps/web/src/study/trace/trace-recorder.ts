import type { Frame, TraceEvent } from "./trace-model.ts";
import { loggedKey } from "./trace-model.ts";
import type { Batcher } from "./trace-store.ts";

export type FrameTools = {
  captureFrame: (doc: Document) => Frame | undefined;
  captureHead: (doc: Document) => string[];
};

export type Recorder = {
  attach: (target: Window | null) => void;
  mark: (taskId: string, edge: "start" | "end", outcome?: string) => void;
  stop: () => Promise<void>;
};

const moveGapMs = 60;
const mutationGapMs = 150;
const frameGapMs = 2000;
const settleMs = 500;
const pollMs = 250;
const frameLimit = 400;

const interactiveSelector =
  'button, a[href], input, select, summary, label, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]';

const textFieldSelector =
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]), textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

function describe(element: Element | null): string {
  if (element === null) return "unknown";
  const hit = element.closest("[data-testid]") ?? element;
  const testId = hit.getAttribute("data-testid");
  const role = hit.getAttribute("role");
  const parts = [hit.tagName.toLowerCase()];
  if (role !== null) parts.push(`[role=${role}]`);
  if (testId !== null) parts.push(`[${testId}]`);
  return parts.join("");
}

const asElement = (target: EventTarget | null): Element | null =>
  target !== null && "closest" in target ? (target as Element) : null;

const readableWindow = (target: Window | null): target is Window => {
  try {
    return target !== null && !target.closed && target.document !== undefined;
  } catch {
    return false;
  }
};

export function createRecorder(options: {
  batcher: Batcher;
  now: () => number;
  frames: () => FrameTools | undefined;
}): Recorder {
  const { batcher, now } = options;
  let target: Window | null = null;
  let current: Document | undefined;
  let lastPath = "";
  let lastMove = 0;
  let lastMutation = 0;
  let lastFrame = 0;
  let dirty = false;
  let frameCount = 0;
  let observer: MutationObserver | undefined;
  let settleTimer: number | undefined;

  const emit = (event: TraceEvent) => batcher.push(event);

  const pathOf = (win: Window) => `${win.location.pathname}${win.location.search}`;

  const takeFrame = () => {
    const frames = options.frames();
    if (frames === undefined || current === undefined || frameCount >= frameLimit) return;
    const frame = frames.captureFrame(current);
    if (frame === undefined) return;
    frameCount += 1;
    lastFrame = now();
    dirty = false;
    emit({ t: lastFrame, k: "frame", frame });
  };

  const onNewDocument = (win: Window) => {
    observer?.disconnect();
    current = win.document;
    lastPath = pathOf(win);
    const navigation = win.performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    emit({
      t: now(),
      k: "load",
      path: lastPath,
      reload: navigation?.type === "reload",
      w: win.innerWidth,
      h: win.innerHeight,
      head: options.frames()?.captureHead(win.document) ?? [],
    });
    const doc = win.document;
    doc.addEventListener(
      "pointermove",
      (event) => {
        const stamp = now();
        if (stamp - lastMove < moveGapMs) return;
        lastMove = stamp;
        emit({ t: stamp, k: "move", x: Math.round(event.clientX), y: Math.round(event.clientY) });
      },
      { capture: true, passive: true },
    );
    doc.addEventListener(
      "click",
      (event) => {
        const element = asElement(event.target);
        emit({
          t: now(),
          k: "click",
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
          target: describe(element),
          interactive: element?.closest(interactiveSelector) != null,
        });
        dirty = true;
      },
      { capture: true, passive: true },
    );
    doc.addEventListener(
      "keydown",
      (event) => {
        const inField = asElement(event.target)?.closest(textFieldSelector) != null;
        emit({ t: now(), k: "key", key: loggedKey(event.key, inField) });
      },
      { capture: true, passive: true },
    );
    const ObserverClass = (win as Window & typeof globalThis).MutationObserver;
    observer = new ObserverClass(() => {
      const stamp = now();
      dirty = true;
      if (stamp - lastMutation < mutationGapMs) return;
      lastMutation = stamp;
      emit({ t: stamp, k: "mutation" });
    });
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(takeFrame, settleMs);
  };

  const poll = () => {
    if (!readableWindow(target)) return;
    if (target.document !== current) {
      onNewDocument(target);
      return;
    }
    const path = pathOf(target);
    if (path !== lastPath) {
      lastPath = path;
      emit({ t: now(), k: "route", path });
      dirty = true;
    }
    if (dirty && now() - lastFrame >= frameGapMs) takeFrame();
  };

  const timer = window.setInterval(poll, pollMs);

  return {
    attach: (next) => {
      target = next;
      poll();
    },
    mark: (taskId, edge, outcome) => {
      if (edge === "end") takeFrame();
      emit({ t: now(), k: "task", taskId, edge, ...(outcome === undefined ? {} : { outcome }) });
      void batcher.flush();
    },
    stop: () => {
      window.clearInterval(timer);
      window.clearTimeout(settleTimer);
      observer?.disconnect();
      return batcher.stop();
    },
  };
}
