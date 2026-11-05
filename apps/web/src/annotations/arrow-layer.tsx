import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import {
  minimumDragScreenPixels,
  type Point,
  type Segment,
  snapToAngle,
} from "../measure/ruler-maths.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import { addArrow, arrowEndsOf, arrowHead, arrowsOf } from "./marks.ts";
import { bindShiftRefresh } from "./shift-refresh.ts";
import { useStageRect } from "./stage-size.ts";

type ArrowLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onApply: (next: AnnotationDocument, label: string) => void;
};

type ArrowDrawing = {
  key: string;
  from: Point;
  to: Point;
  dashed: boolean;
};

function ArrowMark({ drawing }: { drawing: ArrowDrawing }) {
  const [left, right] = arrowHead(drawing.from, drawing.to);
  const path = `M${drawing.from.x} ${drawing.from.y} L${drawing.to.x} ${drawing.to.y} M${left.x} ${left.y} L${drawing.to.x} ${drawing.to.y} L${right.x} ${right.y}`;
  return (
    <g data-testid={drawing.dashed ? "arrow-draft" : "arrow-shape"}>
      <path d={path} fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" />
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(drawing.dashed ? { strokeDasharray: "6 4" } : {})}
      />
    </g>
  );
}

export function ArrowLayer({ engine, stage, active, document: doc, onApply }: ArrowLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [draft, setDraft] = useState<Segment | null>(null);
  const escRegistry = useEscRegistry();
  const latest = useRef({ doc, onApply, engine });
  latest.current = { doc, onApply, engine };

  useEffect(() => {
    if (!active) {
      setDraft(null);
      return;
    }
    let anchor: Point | null = null;
    let pointerId: number | null = null;
    let screenStart: Point | null = null;
    let lastPointer: { clientX: number; clientY: number } | null = null;

    const slidePoint = (event: MouseEvent): Point =>
      screenToSlide(
        latest.current.engine.getCamera(),
        stage.getBoundingClientRect(),
        event.clientX,
        event.clientY,
      );
    const endPoint = (event: MouseEvent, from: Point): Point => {
      const raw = slidePoint(event);
      return event.shiftKey ? snapToAngle(from, raw) : raw;
    };
    const refreshEnd = (shiftHeld: boolean) => {
      if (anchor === null || lastPointer === null) return;
      const raw = screenToSlide(
        latest.current.engine.getCamera(),
        stage.getBoundingClientRect(),
        lastPointer.clientX,
        lastPointer.clientY,
      );
      setDraft({ from: anchor, to: shiftHeld ? snapToAngle(anchor, raw) : raw });
    };
    const cancel = () => {
      anchor = null;
      pointerId = null;
      screenStart = null;
      lastPointer = null;
      setDraft(null);
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      pointerId = event.pointerId;
      anchor = slidePoint(event);
      screenStart = { x: event.clientX, y: event.clientY };
      lastPointer = { clientX: event.clientX, clientY: event.clientY };
      setDraft({ from: anchor, to: anchor });
    };
    const move = (event: PointerEvent) => {
      if (anchor === null || event.pointerId !== pointerId) return;
      event.stopImmediatePropagation();
      lastPointer = { clientX: event.clientX, clientY: event.clientY };
      setDraft({ from: anchor, to: endPoint(event, anchor) });
    };
    const up = (event: PointerEvent) => {
      if (anchor === null || screenStart === null || event.pointerId !== pointerId) return;
      event.stopImmediatePropagation();
      const moved = Math.hypot(event.clientX - screenStart.x, event.clientY - screenStart.y);
      if (moved >= minimumDragScreenPixels) {
        const next = addArrow(latest.current.doc, {
          from: anchor,
          to: endPoint(event, anchor),
        });
        latest.current.onApply(next, "Add arrow");
      }
      stage.releasePointerCapture(event.pointerId);
      cancel();
    };
    const doubleClick = (event: MouseEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
    };

    stage.addEventListener("pointerdown", down, true);
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("dblclick", doubleClick, true);
    const leaveRung = escRegistry?.add("drag", { open: () => anchor !== null, peel: cancel });
    const leaveShift = bindShiftRefresh(stage.ownerDocument, refreshEnd);
    return () => {
      leaveShift();
      stage.removeEventListener("pointerdown", down, true);
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      leaveRung?.();
      cancel();
    };
  }, [active, stage, escRegistry]);

  const drawings: ArrowDrawing[] = arrowsOf(doc).map((shape) => {
    const ends = arrowEndsOf(shape);
    return {
      key: String(shape.id),
      from: slideToScreen(camera, rect, ends.from),
      to: slideToScreen(camera, rect, ends.to),
      dashed: false,
    };
  });
  if (draft !== null) {
    drawings.push({
      key: "draft",
      from: slideToScreen(camera, rect, draft.from),
      to: slideToScreen(camera, rect, draft.to),
      dashed: true,
    });
  }

  return (
    <svg
      data-testid="arrow-layer"
      data-arrows={drawings.filter((item) => !item.dashed).length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {drawings.map((drawing) => (
        <ArrowMark key={drawing.key} drawing={drawing} />
      ))}
    </svg>
  );
}
