import { buttonReleased, keepCapture } from "./stage-pointer.ts";

export const clickSlopScreenPixels = 3;

export type PressEngine = {
  readonly startDrag: (at: { clientX: number; clientY: number }) => void;
  readonly dragTo: (at: { clientX: number; clientY: number }) => void;
  readonly endDrag: () => void;
  readonly stopMotion: () => void;
};

export type PressStage = Pick<
  HTMLElement,
  | "addEventListener"
  | "removeEventListener"
  | "setPointerCapture"
  | "releasePointerCapture"
  | "hasPointerCapture"
  | "isConnected"
>;

export type ClickPressOptions = {
  readonly engine: () => PressEngine;
  readonly onClick: (event: PointerEvent) => void;
  readonly ignore?: (event: PointerEvent) => boolean;
};

type Press = { id: number; x: number; y: number; dragging: boolean };

export function bindClickPress(stage: PressStage, options: ClickPressOptions): () => void {
  let press: Press | null = null;

  const release = (event: PointerEvent) => {
    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      return;
    }
  };

  const down = (event: PointerEvent) => {
    if (event.button !== 0 || press !== null || options.ignore?.(event)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
  };

  const move = (event: PointerEvent) => {
    if (press === null || event.pointerId !== press.id) return;
    event.stopImmediatePropagation();
    if (buttonReleased(event)) {
      up(event);
      return;
    }
    if (!press.dragging) {
      const away = Math.hypot(event.clientX - press.x, event.clientY - press.y);
      if (away <= clickSlopScreenPixels) return;
      press.dragging = true;
      options.engine().startDrag({ clientX: press.x, clientY: press.y });
    }
    options.engine().dragTo({ clientX: event.clientX, clientY: event.clientY });
  };

  const up = (event: PointerEvent) => {
    if (press === null || event.pointerId !== press.id || event.button !== 0) return;
    event.stopImmediatePropagation();
    const finished = press;
    press = null;
    release(event);
    if (finished.dragging) options.engine().endDrag();
    else options.onClick(event);
  };

  const cancel = (event: PointerEvent) => {
    if (press === null || event.pointerId !== press.id) return;
    const finished = press;
    press = null;
    if (finished.dragging) options.engine().stopMotion();
  };

  const lost = keepCapture(stage, (id) => press?.id === id, cancel);

  const doubleClick = (event: MouseEvent) => {
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  stage.addEventListener("pointerdown", down, true);
  stage.addEventListener("pointermove", move, true);
  stage.addEventListener("pointerup", up, true);
  stage.addEventListener("pointercancel", cancel, true);
  stage.addEventListener("lostpointercapture", lost, true);
  stage.addEventListener("dblclick", doubleClick, true);
  return () => {
    stage.removeEventListener("pointerdown", down, true);
    stage.removeEventListener("pointermove", move, true);
    stage.removeEventListener("pointerup", up, true);
    stage.removeEventListener("pointercancel", cancel, true);
    stage.removeEventListener("lostpointercapture", lost, true);
    stage.removeEventListener("dblclick", doubleClick, true);
    press = null;
  };
}
