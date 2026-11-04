import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { markerHitScreenPixels, markerNear, markerPoint, markersOf } from "./count-markers.ts";
import type { AnnotationDocument } from "./document.ts";
import type { Point } from "./polygon-draft.ts";
import type { ShapeId } from "./shapes.ts";

type CountLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  colourOf: (classKey: string | null) => string;
  onDrop: (point: Point) => void;
  onRemove: (id: ShapeId) => void;
};

const clickSlopScreenPixels = 3;

export function CountLayer({
  engine,
  stage,
  active,
  document: doc,
  colourOf,
  onDrop,
  onRemove,
}: CountLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const latest = useRef({ doc, onDrop, onRemove, engine });
  latest.current = { doc, onDrop, onRemove, engine };

  useEffect(() => {
    if (!active) return;
    let pressed: { id: number; x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const up = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id || event.button !== 0) return;
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      pressed = null;
      if (moved > clickSlopScreenPixels) return;
      event.stopImmediatePropagation();
      const current = latest.current.engine.getCamera();
      const point = screenToSlide(
        current,
        stage.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
      if (event.shiftKey) {
        const near = markerNear(
          latest.current.doc,
          point,
          markerHitScreenPixels / 2 ** current.zoom,
        );
        if (near !== null) latest.current.onRemove(near);
        return;
      }
      latest.current.onDrop(point);
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointerup", up, true);
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointerup", up, true);
    };
  }, [active, stage]);

  const rect = { left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight };
  const markers = markersOf(doc);

  return (
    <svg
      data-testid="count-layer"
      data-markers={markers.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {markers.map((shape) => {
        const where = slideToScreen(camera, rect, markerPoint(shape));
        return (
          <circle
            key={shape.id}
            data-testid="count-marker"
            data-class={shape.classKey ?? ""}
            cx={where.x}
            cy={where.y}
            r={5}
            fill={colourOf(shape.classKey)}
            stroke="#fff"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}
