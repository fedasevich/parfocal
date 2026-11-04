import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { finishStroke, strokeSamples } from "./freehand.ts";
import type { Point } from "./polygon-draft.ts";

type FreehandLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  onClose: (points: Float32Array) => void;
};

export function FreehandLayer({ engine, stage, active, onClose }: FreehandLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
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
      stage.releasePointerCapture(event.pointerId);
      const points = drawing.points;
      drawing = null;
      setStroke([]);
      const scale = 2 ** latest.current.engine.getCamera().zoom;
      const closed = finishStroke(points, scale);
      if (closed !== null) latest.current.onClose(closed);
    };
    const cancel = () => {
      drawing = null;
      setStroke([]);
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    const leaveRung = escRegistry?.add("drag", { open: () => drawing !== null, peel: cancel });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  const rect = { left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight };
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
