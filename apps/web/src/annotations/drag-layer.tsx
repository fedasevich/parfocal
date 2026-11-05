import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { type DragKind, dragCorner, dragOutline, finishDrag } from "./drag-shape.ts";
import type { Point } from "./polygon-draft.ts";
import {
  capturePointer,
  interruptMotion,
  releasePointer,
  slideAt,
  stagePoint,
} from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type DragLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  kind: DragKind;
  active: boolean;
  onClose: (points: Float32Array) => void;
};

type Drag = { id: number; start: Point; pointer: Point; equal: boolean };

export function DragLayer({ engine, stage, kind, active, onClose }: DragLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [drag, setDrag] = useState<Drag | null>(null);
  const escRegistry = useEscRegistry();
  const latest = useRef({ onClose, engine, kind });
  latest.current = { onClose, engine, kind };

  useEffect(() => {
    if (!active) {
      setDrag(null);
      return;
    }
    let current: Drag | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || current !== null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      current = {
        id: event.pointerId,
        start: slideAt(latest.current.engine, stage, event),
        pointer: stagePoint(stage, event),
        equal: event.shiftKey,
      };
      setDrag(current);
    };
    const move = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      current = { ...current, pointer: stagePoint(stage, event), equal: event.shiftKey };
      setDrag(current);
    };
    const up = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      const finished = current;
      current = null;
      releasePointer(stage, event.pointerId);
      setDrag(null);
      const outline = finishDrag(
        latest.current.kind,
        finished.start,
        slideAt(latest.current.engine, stage, event),
        event.shiftKey,
        screenScale(latest.current.engine.getCamera()),
      );
      if (outline !== null) latest.current.onClose(outline);
    };
    const cancel = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      current = null;
      setDrag(null);
    };
    const abandon = () => {
      current = null;
      setDrag(null);
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", cancel, true);
    const leaveRung = escRegistry?.add("drag", { open: () => current !== null, peel: abandon });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", cancel, true);
      stage.removeEventListener("lostpointercapture", cancel, true);
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  let path = "";
  if (drag !== null) {
    const end = screenToSlide(camera, rect, drag.pointer.x, drag.pointer.y);
    const outline = dragOutline(kind, drag.start, dragCorner(drag.start, end, drag.equal));
    for (let i = 0; i < outline.length; i += 2) {
      const p = slideToScreen(camera, rect, { x: outline[i] ?? 0, y: outline[i + 1] ?? 0 });
      path += `${i === 0 ? "M" : "L"}${p.x} ${p.y} `;
    }
    path += "Z";
  }

  return (
    <svg
      data-testid="drag-layer"
      data-drawing={drag === null ? 0 : 1}
      data-equal-sides={drag?.equal ? "true" : "false"}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {drag === null ? null : (
        <path
          data-testid="drag-preview"
          d={path}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
