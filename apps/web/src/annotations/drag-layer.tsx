import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { type DragKind, dragCorner, dragOutline, finishDrag } from "./drag-shape.ts";
import type { Point } from "./polygon-draft.ts";

type DragLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  kind: DragKind;
  active: boolean;
  onClose: (points: Float32Array) => void;
};

type Drag = { id: number; start: Point; end: Point; equal: boolean };

export function DragLayer({ engine, stage, kind, active, onClose }: DragLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
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
    const toSlide = (event: PointerEvent): Point =>
      screenToSlide(
        latest.current.engine.getCamera(),
        stage.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      const start = toSlide(event);
      current = { id: event.pointerId, start, end: start, equal: event.shiftKey };
      setDrag(current);
    };
    const move = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      current = { ...current, end: toSlide(event), equal: event.shiftKey };
      setDrag(current);
    };
    const up = (event: PointerEvent) => {
      if (current === null || event.pointerId !== current.id) return;
      event.stopImmediatePropagation();
      stage.releasePointerCapture(event.pointerId);
      const finished = { ...current, end: toSlide(event), equal: event.shiftKey };
      current = null;
      setDrag(null);
      const scale = 2 ** latest.current.engine.getCamera().zoom;
      const outline = finishDrag(
        latest.current.kind,
        finished.start,
        finished.end,
        finished.equal,
        scale,
      );
      if (outline !== null) latest.current.onClose(outline);
    };
    const cancel = () => {
      current = null;
      setDrag(null);
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    const leaveRung = escRegistry?.add("drag", { open: () => current !== null, peel: cancel });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  const rect = { left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight };
  let path = "";
  if (drag !== null) {
    const outline = dragOutline(kind, drag.start, dragCorner(drag.start, drag.end, drag.equal));
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
