import { RulerLine } from "@parfocal/ui/components/viewer-tools";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type AnnotationDocument, addShape } from "../annotations/document.ts";
import { bindShiftRefresh } from "../annotations/shift-refresh.ts";
import { useStageRect } from "../annotations/stage-size.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenToSlide, slideToScreen } from "../viewer/viewer-engine.ts";
import {
  formatRulerLength,
  minimumDragScreenPixels,
  type Point,
  rulerPoints,
  type Segment,
  segmentOfRuler,
  snapToAngle,
  snapToAreaAxis,
} from "./ruler-maths.ts";

type RulerLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onApply: (next: AnnotationDocument, label: string) => void;
};

export function RulerLayer({ engine, stage, active, document: doc, onApply }: RulerLayerProps) {
  const escRegistry = useEscRegistry();
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const [draft, setDraft] = useState<Segment | null>(null);
  const latest = useRef({ doc, onApply, engine });
  latest.current = { doc, onApply, engine };
  const spacing = engine.getSlide()?.micronsPerPixel ?? null;

  useEffect(() => {
    if (!active) {
      setDraft(null);
      return;
    }
    let anchor: Point | null = null;
    let pointerId: number | null = null;
    let screenStart: Point | null = null;
    let lastPointer: { clientX: number; clientY: number } | null = null;

    const slidePoint = (event: MouseEvent): Point => {
      const bounds = stage.getBoundingClientRect();
      return screenToSlide(latest.current.engine.getCamera(), bounds, event.clientX, event.clientY);
    };
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
    const commit = (segment: Segment) => {
      const { document: next } = addShape(latest.current.doc, {
        kind: "ruler",
        points: rulerPoints(segment),
      });
      latest.current.onApply(next, "Add ruler");
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
      if (moved >= minimumDragScreenPixels) commit({ from: anchor, to: endPoint(event, anchor) });
      stage.releasePointerCapture(event.pointerId);
      cancel();
    };
    const doubleClick = (event: MouseEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      const axis = snapToAreaAxis(latest.current.doc, slidePoint(event));
      if (axis !== null) commit(axis);
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

  const drawn: { key: string; segment: Segment; dashed: boolean }[] = [];
  for (const shape of doc.shapes.values()) {
    if (shape.kind === "ruler") {
      drawn.push({ key: String(shape.id), segment: segmentOfRuler(shape), dashed: false });
    }
  }
  if (draft !== null) drawn.push({ key: "draft", segment: draft, dashed: true });

  return (
    <div data-testid="ruler-layer" className="pointer-events-none absolute inset-0 overflow-hidden">
      {drawn.map(({ key, segment, dashed }) => (
        <RulerLine
          key={key}
          dashed={dashed}
          from={slideToScreen(camera, rect, segment.from)}
          to={slideToScreen(camera, rect, segment.to)}
          label={formatRulerLength(segment, spacing)}
        />
      ))}
    </div>
  );
}
