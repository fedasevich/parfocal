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
