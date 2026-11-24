import { deadClickWindowMs } from "./trace/trace-model.ts";

export type TaskCounts = {
  clicks: number;
  deadClicks: number;
  silentControlClicks: number;
  keys: number;
  wheels: number;
};

export type FirstMoves = {
  timeToFirstActionMs: number | null;
  timeToFirstInputMs: number | null;
  firstClickCorrect: boolean | null;
  pathStraightness: number | null;
};

export type TaskMeter = {
  counts: () => TaskCounts;
  firstMoves: () => FirstMoves;
  stop: () => void;
};

export type MeterEvent =
  | { k: "press"; t: number; control: boolean }
  | { k: "click"; t: number; pressedAt: number; control: boolean; dragged: boolean }
  | { k: "key"; t: number; field: boolean }
  | { k: "wheel"; t: number }
  | { k: "change"; t: number };

export type TaskScore = {
  counts: TaskCounts;
  timeToFirstActionMs: number | null;
  timeToFirstInputMs: number | null;
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

export function scoreTask(
  events: readonly MeterEvent[],
  startedAt: number,
  now: number,
  windowMs = deadClickWindowMs,
): TaskScore {
  const changes = events.flatMap((event) => (event.k === "change" ? [event.t] : []));
  const changedBetween = (from: number, to: number) => changes.some((t) => t >= from && t <= to);
  const settled = (at: number) => now - at >= windowMs;
  const counts: TaskCounts = {
    clicks: 0,
    deadClicks: 0,
    silentControlClicks: 0,
    keys: 0,
    wheels: 0,
  };
  let firstAction: number | null = null;
  let firstInput: number | null = null;
  const noteAction = (at: number) => {
    if (firstAction === null || at < firstAction) firstAction = at;
  };
  const noteInput = (at: number) => {
    if (firstInput === null || at < firstInput) firstInput = at;
  };
  for (const event of events) {
    if (event.k === "press") {
      counts.clicks += 1;
      noteInput(event.t);
      if (event.control && settled(event.t) && !changedBetween(event.t, event.t + windowMs))
        counts.silentControlClicks += 1;
    } else if (event.k === "click") {
      if (event.dragged) continue;
      const reacted = changedBetween(event.pressedAt, event.t + windowMs);
      const dead = !event.control && !reacted && settled(event.t);
      if (dead) counts.deadClicks += 1;
      else noteAction(event.t);
    } else if (event.k === "key") {
      noteInput(event.t);
      if (event.field) continue;
      counts.keys += 1;
      if (changedBetween(event.t, event.t + windowMs)) noteAction(event.t);
    } else if (event.k === "wheel") {
      noteInput(event.t);
      counts.wheels += 1;
    }
  }
  const since = (at: number | null) => (at === null ? null : Math.round(at - startedAt));
  return {
    counts,
    timeToFirstActionMs: since(firstAction),
    timeToFirstInputMs: since(firstInput),
  };
}

export const studyUiAttribute = "data-study-ui";

const studyUiSelector = `[${studyUiAttribute}]`;

const wheelGapMs = 100;

const changeGapMs = 20;

export const dragDistancePx = 5;

export const clickableSelector =
  'a[href], button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [role="combobox"], [role="textbox"], [role="slider"]';

const fieldSelector = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

const elementOf = (target: EventTarget | Node | null): Element | null => {
  if (target === null) return null;
  if ("closest" in target && typeof target.closest === "function") return target as Element;
  return "parentElement" in target ? (target as Node).parentElement : null;
};

export const isClickable = (target: EventTarget | Node | null): boolean =>
  elementOf(target)?.closest(clickableSelector) != null;

const inStudyUi = (target: EventTarget | Node | null): boolean =>
  elementOf(target)?.closest(studyUiSelector) != null;

export function startTaskMeter(
  doc: Document,
  clock: () => number = () => performance.now(),
  firstClickTarget?: string,
  camera: () => string = () => "",
): TaskMeter {
  const startedAt = clock();
  const events: MeterEvent[] = [];
  let firstClickCorrect: boolean | null = null;
  let clicked = false;
  let press: { t: number; x: number; y: number; camera: string } | null = null;
  const path: { x: number; y: number }[] = [];
  let lastWheel = Number.NEGATIVE_INFINITY;
  let lastChange = Number.NEGATIVE_INFINITY;
  const view = doc.defaultView ?? window;
  const timers = new Set<number>();

  const watchCamera = (at: number, before: string) => {
    const timer = view.setTimeout(() => {
      timers.delete(timer);
      if (camera() !== before) events.push({ k: "change", t: at });
    }, deadClickWindowMs);
    timers.add(timer);
  };

  const onPointerMove = (event: Event) => {
    if (clicked || !("clientX" in event)) return;
    const { clientX, clientY } = event as PointerEvent;
    path.push({ x: clientX, y: clientY });
  };

  const onPointerDown = (event: Event) => {
    if (inStudyUi(event.target)) return;
    const at = clock();
    const { clientX = 0, clientY = 0 } = event as Partial<PointerEvent>;
    press = { t: at, x: clientX, y: clientY, camera: camera() };
    events.push({ k: "press", t: at, control: isClickable(event.target) });
    if (clicked) return;
    clicked = true;
    path.push({ x: clientX, y: clientY });
    if (firstClickTarget === undefined) return;
    try {
      firstClickCorrect = elementOf(event.target)?.closest(firstClickTarget) != null;
    } catch {
      firstClickCorrect = null;
    }
  };

  const onClick = (event: Event) => {
    if (inStudyUi(event.target) || press === null) return;
    const { clientX = press.x, clientY = press.y } = event as Partial<MouseEvent>;
    const at = clock();
    watchCamera(at, press.camera);
    events.push({
      k: "click",
      t: at,
      pressedAt: press.t,
      control: isClickable(event.target),
      dragged: Math.hypot(clientX - press.x, clientY - press.y) >= dragDistancePx,
    });
    press = null;
  };

  const onKey = (event: Event) => {
    const target = elementOf(event.target);
    if (inStudyUi(target)) return;
    const at = clock();
    watchCamera(at, camera());
    events.push({ k: "key", t: at, field: target?.closest(fieldSelector) != null });
  };

  const onWheel = (event: Event) => {
    if (inStudyUi(event.target)) return;
    const at = clock();
    if (at - lastWheel < wheelGapMs) return;
    lastWheel = at;
    events.push({ k: "wheel", t: at });
  };

  const observer = new view.MutationObserver((records) => {
    if (!records.some((record) => !inStudyUi(record.target))) return;
    const at = clock();
    if (at - lastChange < changeGapMs) return;
    lastChange = at;
    events.push({ k: "change", t: at });
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
  doc.addEventListener("click", onClick, options);
  doc.addEventListener("keydown", onKey, options);
  doc.addEventListener("wheel", onWheel, options);

  const score = () => scoreTask(events, startedAt, clock());

  return {
    counts: () => score().counts,
    firstMoves: () => {
      const { timeToFirstActionMs, timeToFirstInputMs } = score();
      return {
        timeToFirstActionMs,
        timeToFirstInputMs,
        firstClickCorrect,
        pathStraightness: clicked ? straightness(path) : null,
      };
    },
    stop: () => {
      doc.removeEventListener("pointerdown", onPointerDown, options);
      doc.removeEventListener("pointermove", onPointerMove, options);
      doc.removeEventListener("click", onClick, options);
      doc.removeEventListener("keydown", onKey, options);
      doc.removeEventListener("wheel", onWheel, options);
      observer.disconnect();
      for (const timer of timers) view.clearTimeout(timer);
      timers.clear();
    },
  };
}
