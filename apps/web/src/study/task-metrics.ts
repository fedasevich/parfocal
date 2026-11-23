import { deadClickWindowMs } from "./trace/trace-model.ts";

export type TaskCounts = {
  clicks: number;
  deadClicks: number;
  keys: number;
  wheels: number;
};

export type TaskMeter = {
  counts: () => TaskCounts;
  stop: () => void;
};

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
): TaskMeter {
  const counts: TaskCounts = { clicks: 0, deadClicks: 0, keys: 0, wheels: 0 };
  let lastWheel = Number.NEGATIVE_INFINITY;
  let lastChange = Number.NEGATIVE_INFINITY;
  const timers = new Set<number>();
  const view = doc.defaultView ?? window;

  const onPointerDown = (event: Event) => {
    if (inStudyUi(event.target)) return;
    counts.clicks += 1;
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
    if (inStudyUi(target) || target?.closest(fieldSelector) != null) return;
    counts.keys += 1;
  };

  const onWheel = (event: Event) => {
    if (inStudyUi(event.target)) return;
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
  doc.addEventListener("keydown", onKey, options);
  doc.addEventListener("wheel", onWheel, options);

  return {
    counts: () => ({ ...counts }),
    stop: () => {
      doc.removeEventListener("pointerdown", onPointerDown, options);
      doc.removeEventListener("keydown", onKey, options);
      doc.removeEventListener("wheel", onWheel, options);
      observer.disconnect();
      for (const timer of timers) view.clearTimeout(timer);
      timers.clear();
    },
  };
}
