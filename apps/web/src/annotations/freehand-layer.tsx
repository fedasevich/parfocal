import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, slideToScreen } from "../viewer/viewer-engine.ts";
import { finishStroke, strokeSamples } from "./freehand.ts";
import type { Point } from "./polygon-draft.ts";
import { capturePointer, interruptMotion, releasePointer, slideAt } from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type FreehandLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  onClose: (points: Float32Array) => void;
};

export function FreehandLayer({ engine, stage, active, onClose }: FreehandLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [stroke, setStroke] = useState<readonly Point[]>([]);
  const escRegistry = useEscRegistry();
  const latest = useRef({ onClose, engine });
  latest.current = { onClose, engine };

  useEffect(() => {
    if (!active) {
      setStroke([]);
      return;
    }
    let drawing: { id: number; points: Point[] } | null = null;
    const toSlide = (event: PointerEvent): Point => slideAt(latest.current.engine, stage, event);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || drawing !== null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      drawing = { id: event.pointerId, points: [toSlide(event)] };
      setStroke(drawing.points);
    };
    const move = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      event.stopImmediatePropagation();
      for (const sample of strokeSamples(event)) drawing.points.push(toSlide(sample));
      setStroke([...drawing.points]);
    };
    const up = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      event.stopImmediatePropagation();
      const points = drawing.points;
      drawing = null;
      releasePointer(stage, event.pointerId);
      setStroke([]);
      const closed = finishStroke(points, screenScale(latest.current.engine.getCamera()));
      if (closed !== null) latest.current.onClose(closed);
    };
    const cancel = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      drawing = null;
      setStroke([]);
    };
    const abandon = () => {
      drawing = null;
      setStroke([]);
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", cancel, true);
    const leaveRung = escRegistry?.add("drag", { open: () => drawing !== null, peel: abandon });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", cancel, true);
      stage.removeEventListener("lostpointercapture", cancel, true);
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  const path = stroke
    .map((point, index) => {
      const p = slideToScreen(camera, rect, point);
      return `${index === 0 ? "M" : "L"}${p.x} ${p.y}`;
    })
    .join(" ");

  return (
    <svg
      data-testid="freehand-layer"
      data-drawing={stroke.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {stroke.length > 1 ? (
        <path
          d={path}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
