import { deadClickWindowMs } from "./trace/trace-model.ts";

export type TaskCounts = {
  clicks: number;
  deadClicks: number;
  keys: number;
  wheels: number;
};

export type FirstMoves = {
  timeToFirstActionMs: number | null;
  firstClickCorrect: boolean | null;
  pathStraightness: number | null;
};

export type TaskMeter = {
  counts: () => TaskCounts;
  firstMoves: () => FirstMoves;
  stop: () => void;
};

export function straightness(points: readonly { x: number; y: number }[]): number | null {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || points.length < 2) return null;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (from !== undefined && to !== undefined)
      travelled += Math.hypot(to.x - from.x, to.y - from.y);
  }
  if (travelled === 0) return null;
  const direct = Math.hypot(last.x - first.x, last.y - first.y);
  return Math.round(Math.min(1, direct / travelled) * 100) / 100;
}

export const studyUiAttribute = "data-study-ui";

const studyUiSelector = `[${studyUiAttribute}]`;

const wheelGapMs = 100;

const interactiveSelector =
  'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"]';

const fieldSelector = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

const elementOf = (target: EventTarget | Node | null): Element | null => {
  if (target === null) return null;
  if ("closest" in target && typeof target.closest === "function") return target as Element;
  return "parentElement" in target ? (target as Node).parentElement : null;
};

const inStudyUi = (target: EventTarget | Node | null): boolean =>
  elementOf(target)?.closest(studyUiSelector) != null;

export function startTaskMeter(
  doc: Document,
  clock: () => number = () => performance.now(),
  firstClickTarget?: string,
): TaskMeter {
  const counts: TaskCounts = { clicks: 0, deadClicks: 0, keys: 0, wheels: 0 };
  const startedAt = clock();
  let firstActionAt: number | null = null;
  let firstClickCorrect: boolean | null = null;
  let clicked = false;
  const path: { x: number; y: number }[] = [];
  const noteAction = () => {
    if (firstActionAt === null) firstActionAt = clock();
  };

  const onPointerMove = (event: Event) => {
    if (clicked || !("clientX" in event)) return;
    const { clientX, clientY } = event as PointerEvent;
    path.push({ x: clientX, y: clientY });
  };
  let lastWheel = Number.NEGATIVE_INFINITY;
  let lastChange = Number.NEGATIVE_INFINITY;
  const timers = new Set<number>();
  const view = doc.defaultView ?? window;

  const onPointerDown = (event: Event) => {
    if (inStudyUi(event.target)) return;
    counts.clicks += 1;
    noteAction();
    if (!clicked) {
      clicked = true;
      if ("clientX" in event) {
        const { clientX, clientY } = event as PointerEvent;
        path.push({ x: clientX, y: clientY });
      }
      if (firstClickTarget !== undefined) {
        try {
          firstClickCorrect = elementOf(event.target)?.closest(firstClickTarget) != null;
        } catch {
          firstClickCorrect = null;
        }
      }
    }
    if (elementOf(event.target)?.closest(interactiveSelector) == null) return;
    const clickedAt = clock();
    const timer = view.setTimeout(() => {
      timers.delete(timer);
      if (lastChange < clickedAt) counts.deadClicks += 1;
    }, deadClickWindowMs);
    timers.add(timer);
  };

  const onKey = (event: Event) => {
    const target = elementOf(event.target);
    if (inStudyUi(target)) return;
    noteAction();
    if (target?.closest(fieldSelector) != null) return;
    counts.keys += 1;
  };

  const onWheel = (event: Event) => {
    if (inStudyUi(event.target)) return;
    noteAction();
    const at = clock();
    if (at - lastWheel < wheelGapMs) return;
    lastWheel = at;
    counts.wheels += 1;
  };

  const observer = new view.MutationObserver((records) => {
    if (records.some((record) => !inStudyUi(record.target))) lastChange = clock();
  });
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  const options = { capture: true, passive: true };
  doc.addEventListener("pointerdown", onPointerDown, options);
  doc.addEventListener("pointermove", onPointerMove, options);
  doc.addEventListener("keydown", onKey, options);
  doc.addEventListener("wheel", onWheel, options);

  return {
    counts: () => ({ ...counts }),
    firstMoves: () => ({
      timeToFirstActionMs: firstActionAt === null ? null : Math.round(firstActionAt - startedAt),
      firstClickCorrect,
      pathStraightness: clicked ? straightness(path) : null,
    }),
    stop: () => {
      doc.removeEventListener("pointerdown", onPointerDown, options);
      doc.removeEventListener("pointermove", onPointerMove, options);
      doc.removeEventListener("keydown", onKey, options);
      doc.removeEventListener("wheel", onWheel, options);
      observer.disconnect();
      for (const timer of timers) view.clearTimeout(timer);
      timers.clear();
    },
  };
}
