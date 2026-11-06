import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { bindClickPress } from "./click-press.ts";
import { markerHitScreenPixels, markerNear, markerPoint, markersOf } from "./count-markers.ts";
import { type AnnotationDocument, isShapeHidden } from "./document.ts";
import type { Point } from "./polygon-draft.ts";
import type { ShapeId } from "./shapes.ts";
import { useStageRect } from "./stage-size.ts";

type CountLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  colourOf: (classKey: string | null) => string;
  onDrop: (point: Point) => void;
  onRemove: (id: ShapeId) => void;
};

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
  const rect = useStageRect(stage);
  const latest = useRef({ doc, onDrop, onRemove, engine });
  latest.current = { doc, onDrop, onRemove, engine };

  useEffect(() => {
    if (!active) return;
    const click = (event: PointerEvent) => {
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
    return bindClickPress(stage, { engine: () => latest.current.engine, onClick: click });
  }, [active, stage]);

  const markers = markersOf(doc).filter((shape) => !isShapeHidden(doc, shape));

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
