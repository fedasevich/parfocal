import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { isTyping } from "../keys/registry.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import { type AnnotationDocument, isShapeHidden } from "./document.ts";
import {
  clickDraft,
  closeDraft,
  echoesClose,
  type Point,
  type PolygonDraft,
  snapTo45,
  type TimedPoint,
} from "./polygon-draft.ts";
import { at } from "./shapes.ts";
import {
  bindSpacePan,
  buttonReleased,
  capturePointer,
  interruptMotion,
  keepCapture,
  releasePointer,
  slideAt,
  stagePoint,
} from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type PolygonLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onClose: (points: Float32Array) => void;
  draftControl?: RefObject<DraftControl | null>;
};

export type DraftControl = { readonly depth: () => number; readonly pop: () => void };

type Pointer = Point & { readonly shift: boolean };

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
  draftControl,
}: PolygonLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [draft, setDraft] = useState<PolygonDraft>([]);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const escRegistry = useEscRegistry();
  const latest = useRef({ draft, onClose, engine });
  latest.current = { draft, onClose, engine };

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
      setPointer(null);
      return;
    }
    let pressed: { id: number; x: number; y: number } | null = null;
    const pan = bindSpacePan(stage, {
      engine: () => latest.current.engine,
      gesturing: () => pressed !== null,
    });
    let lastClose: TimedPoint | null = null;
    const toSlide = (event: MouseEvent): Point => {
      const point = slideAt(latest.current.engine, stage, event);
      return event.shiftKey ? snapTo45(latest.current.draft, point) : point;
    };
    const toScreen = (point: Point): Point =>
      slideToScreen(latest.current.engine.getCamera(), stage.getBoundingClientRect(), point);
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
      if (event.button !== 0 || pan.held()) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      setPointer({ ...stagePoint(stage, event), shift: event.shiftKey });
      if (pressed === null) {
        pan.track(event);
        return;
      }
      event.stopImmediatePropagation();
      if (buttonReleased(event)) {
        up(event);
        return;
      }
      pan.steer(event);
    };
    const up = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id) return;
      event.stopImmediatePropagation();
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      const panned = pan.panning();
      pressed = null;
      pan.release();
      releasePointer(stage, event.pointerId);
      if (panned) return;
      if (moved > clickSlopScreenPixels) return;
      const click = { ...stagePoint(stage, event), time: event.timeStamp };
      if (echoesClose(lastClose, click)) return;
      const next = clickDraft(latest.current.draft, toSlide(event), toScreen);
      if (next.kind === "closed") lastClose = click;
      apply(next);
    };
    const cancel = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id) return;
      pressed = null;
    };
    const lost = keepCapture(stage, (id) => pressed?.id === id, cancel);
    const leave = () => {
      if (pressed === null) setPointer(null);
    };
    const doubleClick = (event: MouseEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      apply(closeDraft(latest.current.draft));
    };
    const shiftChanged = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      const shift = event.type === "keydown";
      setPointer((current) =>
        current === null || current.shift === shift ? current : { ...current, shift },
      );
    };
    const key = (event: KeyboardEvent) => {
      shiftChanged(event);
      if (isTyping(event.target)) return;
      if (event.key === "Enter") apply(closeDraft(latest.current.draft));
      if (event.key === "Backspace" && latest.current.draft.length > 0) {
        event.preventDefault();
        const next = latest.current.draft.slice(0, -1);
        latest.current.draft = next;
        setDraft(next);
      }
    };

    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", cancel, true);
    stage.addEventListener("lostpointercapture", lost, true);
    stage.addEventListener("pointerleave", leave, true);
    stage.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", shiftChanged);
    const leaveRung = escRegistry?.add("draft", {
      open: () => latest.current.draft.length > 0,
      peel: () => {
        latest.current.draft = [];
        setDraft([]);
      },
    });
    return () => {
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", cancel, true);
      stage.removeEventListener("lostpointercapture", lost, true);
      stage.removeEventListener("pointerleave", leave, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", shiftChanged);
      pan.dispose();
      leaveRung?.();
    };
  }, [active, stage, escRegistry]);

  const project = (point: Point) => slideToScreen(camera, rect, point);
  const saved = [...doc.shapes.values()].filter(
    (shape) => shape.kind === "polygon" && !isShapeHidden(doc, shape),
  );
  const draftScreen = draft.map(project);
  const hover =
    pointer === null
      ? null
      : pointer.shift
        ? project(snapTo45(draft, screenToSlide(camera, rect, pointer.x, pointer.y)))
        : pointer;
  const rubber = hover !== null && draft.length > 0 ? [...draftScreen, hover] : null;

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
          data-testid="polygon-rubber"
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
