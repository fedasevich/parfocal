import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide } from "../viewer/viewer-engine.ts";
import type { Point } from "./polygon-draft.ts";

export type ClientPoint = { readonly clientX: number; readonly clientY: number };

export type PointerStage = Pick<
  HTMLElement,
  "setPointerCapture" | "releasePointerCapture" | "hasPointerCapture"
>;

export type MotionEngine = Pick<ViewerEngine, "getMotion" | "stopMotion">;

export type SlideEngine = Pick<ViewerEngine, "getCamera">;

export function stagePoint(
  stage: Pick<HTMLElement, "getBoundingClientRect">,
  at: ClientPoint,
): Point {
  const bounds = stage.getBoundingClientRect();
  return { x: at.clientX - bounds.left, y: at.clientY - bounds.top };
}

export function slideAt(
  engine: SlideEngine,
  stage: Pick<HTMLElement, "getBoundingClientRect">,
  at: ClientPoint,
): Point {
  return screenToSlide(engine.getCamera(), stage.getBoundingClientRect(), at.clientX, at.clientY);
}

export function capturePointer(stage: PointerStage, pointerId: number): void {
  try {
    stage.setPointerCapture(pointerId);
  } catch {
    return;
  }
}

export function releasePointer(stage: PointerStage, pointerId: number): void {
  try {
    if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  } catch {
    return;
  }
}

export function interruptMotion(engine: MotionEngine): void {
  const motion = engine.getMotion();
  if (motion === "coasting" || motion === "flying") engine.stopMotion();
}

export type PanEngine = Pick<ViewerEngine, "startDrag" | "dragTo" | "endDrag" | "stopMotion">;

export interface SpacePan {
  readonly held: () => boolean;
  readonly panning: () => boolean;
  readonly track: (at: ClientPoint) => void;
  readonly steer: (at: ClientPoint) => boolean;
  readonly release: () => void;
  readonly dispose: () => void;
}

export type SpacePanOptions = {
  readonly engine: () => PanEngine;
  readonly gesturing: () => boolean;
  readonly typing?: (target: EventTarget | null) => boolean;
};

const typingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest("input, textarea, select, [contenteditable=''], [contenteditable=true]") !== null;

export function bindSpacePan(
  stage: Pick<HTMLElement, "style" | "ownerDocument">,
  options: SpacePanOptions,
): SpacePan {
  const view = stage.ownerDocument.defaultView ?? window;
  const typing = options.typing ?? typingTarget;
  let held = false;
  let panning = false;
  let last: ClientPoint | null = null;
  let savedCursor: string | null = null;

  const showHand = () => {
    if (savedCursor === null) savedCursor = stage.style.cursor;
    stage.style.cursor = "grab";
  };
  const hideHand = () => {
    if (savedCursor !== null) stage.style.cursor = savedCursor;
    savedCursor = null;
  };
  const release = () => {
    if (!panning) return;
    panning = false;
    options.engine().endDrag();
    options.engine().stopMotion();
  };
  const down = (event: KeyboardEvent) => {
    if (event.key !== " " || typing(event.target)) return;
    event.preventDefault();
    if (event.repeat || held) return;
    held = true;
    showHand();
    if (options.gesturing() && last !== null) {
      panning = true;
      options.engine().startDrag(last);
    }
  };
  const up = (event: KeyboardEvent) => {
    if (event.key !== " ") return;
    held = false;
    release();
    hideHand();
  };
  const blur = () => {
    held = false;
    release();
    hideHand();
  };
  view.addEventListener("keydown", down);
  view.addEventListener("keyup", up);
  view.addEventListener("blur", blur);
  return {
    held: () => held,
    panning: () => panning,
    track: (at) => {
      last = { clientX: at.clientX, clientY: at.clientY };
    },
    steer: (at) => {
      last = { clientX: at.clientX, clientY: at.clientY };
      if (!panning) return false;
      options.engine().dragTo(last);
      return true;
    },
    release,
    dispose: () => {
      view.removeEventListener("keydown", down);
      view.removeEventListener("keyup", up);
      view.removeEventListener("blur", blur);
      release();
      hideHand();
    },
  };
}
