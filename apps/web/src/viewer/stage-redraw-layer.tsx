import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  clickDraft,
  closeDraft,
  type Point,
  type PolygonDraft,
} from "../annotations/polygon-draft.ts";
import {
  bindSpacePan,
  capturePointer,
  interruptMotion,
  releasePointer,
  slideAt,
} from "../annotations/stage-pointer.ts";
import { useStageRect } from "../annotations/stage-size.ts";
import { fingerPans } from "../devices/pen-touch.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { isTyping } from "../keys/registry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";
import { slideToScreen } from "./viewer-engine.ts";

const clickSlopScreenPixels = 3;

const controls = "button, a, input, textarea, select, [role=toolbar], [role=dialog], [role=group]";

const onControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest(controls) !== null;

function pathOf(points: readonly Point[], closed: boolean): string {
  const body = points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return closed ? `${body} Z` : body;
}

export function StageRedrawLayer({
  engine,
  stage,
  draft,
  onDraft,
  onClose,
  onCancel,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  draft: PolygonDraft;
  onDraft: (draft: PolygonDraft) => void;
  onClose: (points: Float32Array) => void;
  onCancel: () => void;
}) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const escRegistry = useEscRegistry();
  const latest = useRef({ draft, onDraft, onClose, onCancel, engine });
  latest.current = { draft, onDraft, onClose, onCancel, engine };

  useEffect(() => {
    const surface = stage.parentElement ?? stage;
    let pressed: { id: number; x: number; y: number } | null = null;
    const pan = bindSpacePan(stage, {
      engine: () => latest.current.engine,
      gesturing: () => pressed !== null,
    });
    const toScreen = (point: Point): Point =>
      slideToScreen(latest.current.engine.getCamera(), stage.getBoundingClientRect(), point);
    const apply = (step: ReturnType<typeof clickDraft>) => {
      if (step.kind === "closed") latest.current.onClose(step.points);
      else latest.current.onDraft(step.draft);
    };
    const down = (event: PointerEvent) => {
      if (fingerPans(event) || event.button !== 0 || pan.held()) return;
      if (onControl(event.target)) return;
      event.stopPropagation();
      event.preventDefault();
      interruptMotion(latest.current.engine);
      capturePointer(stage, event.pointerId);
      pressed = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const move = (event: PointerEvent) => {
      if (pressed === null) {
        pan.track(event);
        return;
      }
      event.stopPropagation();
      pan.steer(event);
    };
    const up = (event: PointerEvent) => {
      if (pressed === null || event.pointerId !== pressed.id) return;
      event.stopPropagation();
      const moved = Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y);
      const panned = pan.panning();
      pressed = null;
      pan.release();
      releasePointer(stage, event.pointerId);
      if (panned || moved > clickSlopScreenPixels) return;
      apply(
        clickDraft(latest.current.draft, slideAt(latest.current.engine, stage, event), toScreen),
      );
    };
    const doubleClick = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      apply(closeDraft(latest.current.draft));
    };
    const key = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.key === "Enter") apply(closeDraft(latest.current.draft));
      if (event.key === "Backspace" && latest.current.draft.length > 0) {
        event.preventDefault();
        latest.current.onDraft(latest.current.draft.slice(0, -1));
      }
    };
    surface.addEventListener("pointerdown", down, true);
    surface.addEventListener("pointermove", move, true);
    surface.addEventListener("pointerup", up, true);
    surface.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key);
    const leaveRung = escRegistry?.add("draft", {
      open: () => true,
      peel: () => latest.current.onCancel(),
    });
    return () => {
      surface.removeEventListener("pointerdown", down, true);
      surface.removeEventListener("pointermove", move, true);
      surface.removeEventListener("pointerup", up, true);
      surface.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key);
      pan.dispose();
      leaveRung?.();
    };
  }, [stage, escRegistry]);

  const project = (point: Point) => slideToScreen(camera, rect, point);
  const shown = draft.map(project);
  return (
    <svg
      data-testid="redraw-layer"
      data-points={draft.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {shown.length > 1 ? (
        <path
          d={pathOf(shown, false)}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinejoin="round"
        />
      ) : null}
      {shown.map((vertex, index) => (
        <circle
          key={`${draft[index]?.x}:${draft[index]?.y}`}
          data-testid="redraw-vertex"
          cx={vertex.x}
          cy={vertex.y}
          r={index === 0 ? 6 : 4}
          fill="#fff"
          className="stroke-accent"
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}
