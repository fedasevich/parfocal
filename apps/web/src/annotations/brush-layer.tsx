import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, slideToScreen } from "../viewer/viewer-engine.ts";
import {
  type BrushMode,
  brushDefaultSize,
  brushModeOf,
  loadClipper,
  mapOf,
  paintStroke,
  stepBrushSize,
} from "./brush.ts";
import { type AnnotationDocument, isShapeHidden } from "./document.ts";
import { strokeSamples } from "./freehand.ts";
import type { Point } from "./polygon-draft.ts";
import { at, ringCount, ringOf } from "./shapes.ts";
import {
  bindSpacePan,
  buttonReleased,
  capturePointer,
  interruptMotion,
  keepCapture,
  releasePointer,
  slideAt,
} from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type BrushLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  classKey: string | null;
  colour: string;
  onApply: (next: AnnotationDocument, label: string) => void;
};

type Drawing = { id: number; mode: BrushMode; points: Point[] };

export function BrushLayer({
  engine,
  stage,
  active,
  document,
  classKey,
  colour,
  onApply,
}: BrushLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [stroke, setStroke] = useState<{ mode: BrushMode; points: readonly Point[] } | null>(null);
  const [size, setSize] = useState(brushDefaultSize);
  const escRegistry = useEscRegistry();
  const latest = useRef({ engine, document, classKey, onApply, size });
  latest.current = { engine, document, classKey, onApply, size };

  useEffect(() => {
    if (!active) {
      setStroke(null);
      return;
    }
    void loadClipper();
    let drawing: Drawing | null = null;
    const pan = bindSpacePan(stage, {
      engine: () => latest.current.engine,
      gesturing: () => drawing !== null,
    });
    const toSlide = (event: PointerEvent): Point => slideAt(latest.current.engine, stage, event);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || drawing !== null || pan.held()) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      drawing = { id: event.pointerId, mode: brushModeOf(event), points: [toSlide(event)] };
      setStroke({ mode: drawing.mode, points: [...drawing.points] });
    };
    const move = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) {
        pan.track(event);
        return;
      }
      event.stopImmediatePropagation();
      if (buttonReleased(event)) {
        up(event);
        return;
      }
      if (pan.steer(event)) return;
      for (const sample of strokeSamples(event)) drawing.points.push(toSlide(sample));
      setStroke({ mode: drawing.mode, points: [...drawing.points] });
    };
    const up = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      event.stopImmediatePropagation();
      const done = drawing;
      drawing = null;
      pan.release();
      releasePointer(stage, event.pointerId);
      setStroke(null);
      const diameter = latest.current.size / screenScale(latest.current.engine.getCamera());
      void loadClipper().then(() => {
        const { document: doc, classKey: key, onApply: apply } = latest.current;
        const next = paintStroke(doc, {
          points: done.points,
          diameter,
          mode: done.mode,
          classKey: key,
        });
        apply(next, done.mode === "erase" ? "Erase map" : "Paint map");
      });
    };
    const cancel = (event: PointerEvent) => {
      if (drawing === null || event.pointerId !== drawing.id) return;
      drawing = null;
      pan.release();
      setStroke(null);
    };
    const lost = keepCapture(stage, (id) => drawing?.id === id, cancel);
    const abandon = () => {
      drawing = null;
      pan.release();
      setStroke(null);
    };
    const resize = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === "[") setSize((value) => stepBrushSize(value, -1));
      if (event.key === "]") setSize((value) => stepBrushSize(value, 1));
    };
    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", lost, true);
    window.addEventListener("keydown", resize);
    const leaveRung = escRegistry?.add("drag", { open: () => drawing !== null, peel: abandon });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", cancel, true);
      stage.removeEventListener("lostpointercapture", lost, true);
      window.removeEventListener("keydown", resize);
      pan.dispose();
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  const map = mapOf(document, classKey);
  const mapPath =
    map === null || isShapeHidden(document, map)
      ? ""
      : Array.from({ length: ringCount(map) }, (_, ring) => {
          const points = ringOf(map, ring);
          let path = "";
          for (let i = 0; i + 1 < points.length; i += 2) {
            const p = slideToScreen(camera, rect, { x: at(points, i), y: at(points, i + 1) });
            path += `${i === 0 ? "M" : "L"}${p.x} ${p.y}`;
          }
          return `${path}Z`;
        }).join("");
  const strokePath =
    stroke === null
      ? ""
      : stroke.points
          .map((point, index) => {
            const p = slideToScreen(camera, rect, point);
            return `${index === 0 ? "M" : "L"}${p.x} ${p.y}`;
          })
          .join(" ");

  return (
    <svg
      data-testid="brush-layer"
      data-size={size}
      data-drawing={stroke === null ? 0 : stroke.points.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {mapPath === "" ? null : (
        <path
          data-testid="brush-map"
          d={mapPath}
          fillRule="evenodd"
          fill={colour}
          fillOpacity={0.4}
        />
      )}
      {stroke === null ? null : (
        <path
          d={`${strokePath}${stroke.points.length === 1 ? "l0 0" : ""}`}
          fill="none"
          stroke={stroke.mode === "erase" ? "#fff" : colour}
          strokeOpacity={0.5}
          strokeWidth={size}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
