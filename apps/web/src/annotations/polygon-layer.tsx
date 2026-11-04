import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import {
  clickDraft,
  closeDraft,
  type Point,
  type PolygonDraft,
  snapTo45,
} from "./polygon-draft.ts";
import { at } from "./shapes.ts";

type PolygonLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onClose: (points: Float32Array) => void;
  onLeave: () => void;
  draftControl?: RefObject<DraftControl | null>;
};

export type DraftControl = { readonly depth: () => number; readonly pop: () => void };

const clickSlopScreenPixels = 3;

function pathOf(points: readonly Point[], closed: boolean): string {
  const body = points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return closed ? `${body} Z` : body;
}

function verticesOf(points: Float32Array): Point[] {
  return Array.from({ length: points.length >> 1 }, (_, index) => ({
    x: at(points, index * 2),
    y: at(points, index * 2 + 1),
  }));
}

export function PolygonLayer({
  engine,
  stage,
  active,
  document: doc,
  onClose,
  onLeave,
  draftControl,
}: PolygonLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const [draft, setDraft] = useState<PolygonDraft>([]);
  const [hover, setHover] = useState<Point | null>(null);
  const latest = useRef({ draft, onClose, onLeave, engine });
  latest.current = { draft, onClose, onLeave, engine };

  useEffect(() => {
    if (!draftControl) return;
    draftControl.current = {
      depth: () => latest.current.draft.length,
      pop: () => {
        const next = latest.current.draft.slice(0, -1);
        latest.current.draft = next;
        setDraft(next);
      },
    };
    return () => {
      draftControl.current = null;
    };
  }, [draftControl]);

  useEffect(() => {
    if (!active) {
      const pending = latest.current.draft;
      if (pending.length > 0) {
        latest.current.draft = [];
        const step = closeDraft(pending);
        if (step.kind === "closed") latest.current.onClose(step.points);
      }
      setDraft([]);
      setHover(null);
      return;
    }
    let pressed: { id: number; x: number; y: number } | null = null;
    const bounds = () => stage.getBoundingClientRect();
    const toSlide = (event: MouseEvent): Point => {
      const point = screenToSlide(
        latest.current.engine.getCamera(),
        bounds(),
        event.clientX,
        event.clientY,
      );
      return event.shiftKey ? snapTo45(latest.current.draft, point) : point;
    };
    const toScreen = (point: Point): Point =>
      slideToScreen(latest.current.engine.getCamera(), bounds(), point);
    const apply = (next: ReturnType<typeof clickDraft>) => {
      if (next.kind === "closed") {
        setDraft([]);
        latest.current.draft = [];
        latest.current.onClose(next.points);
        return;
      }
      latest.current.draft = next.draft;
      setDraft(next.draft);
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (pressed !== null) event.stopImmediatePropagation();
      setHover(toSlide(event));
    };
    const up = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id) return;
      event.stopImmediatePropagation();
      stage.releasePointerCapture(event.pointerId);
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      pressed = null;
      if (moved > clickSlopScreenPixels) return;
      apply(clickDraft(latest.current.draft, toSlide(event), toScreen));
    };
    const doubleClick = (event: MouseEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      apply(closeDraft(latest.current.draft));
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        apply(closeDraft(latest.current.draft));
        return;
      }
      if (event.key !== "Escape") return;
      if (latest.current.draft.length > 0) {
        latest.current.draft = [];
        setDraft([]);
      } else {
        latest.current.onLeave();
      }
    };

    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key);
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key);
    };
  }, [active, stage]);

  const rect = { left: 0, top: 0, width: stage.clientWidth, height: stage.clientHeight };
  const project = (point: Point) => slideToScreen(camera, rect, point);
  const saved = [...doc.shapes.values()].filter((shape) => shape.kind === "polygon");
  const draftScreen = draft.map(project);
  const rubber = hover !== null && draft.length > 0 ? [...draftScreen, project(hover)] : null;

  return (
    <svg
      data-testid="polygon-layer"
      data-drafting={draft.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {saved.map((shape) => (
        <path
          key={shape.id}
          data-testid="polygon-shape"
          data-points={shape.points.length >> 1}
          data-vertices={Array.from(shape.points, (value) => Math.round(value)).join(" ")}
          d={pathOf(verticesOf(shape.points).map(project), true)}
          className="fill-accent/15 stroke-accent"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ))}
      {rubber ? (
        <path
          d={pathOf(rubber, false)}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
        />
      ) : null}
      {draft.map((vertex) => (
        <circle
          key={`${vertex.x}:${vertex.y}`}
          data-testid="polygon-vertex"
          cx={project(vertex).x}
          cy={project(vertex).y}
          r={vertex === draft[0] ? 6 : 4}
          fill="#fff"
          className="stroke-accent"
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}
