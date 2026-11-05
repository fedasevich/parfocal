import type { PointerInput } from "@parfocal/viewer-engine";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import { handlesOf } from "./reshape.ts";
import { createSelectTool, type SelectTool } from "./select-tool.ts";
import { at, isClosedKind, outlineOf, type Shape } from "./shapes.ts";
import { capturePointer, interruptMotion, slideAt } from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type SelectLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onDocumentChange: (next: AnnotationDocument) => void;
  onCommit?: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
};

type Screen = { x: number; y: number };

const pointerKinds = {
  pointerdown: "down",
  pointermove: "move",
  pointerup: "up",
  pointercancel: "cancel",
  lostpointercapture: "lostcapture",
} as const;

function pointerInput(event: PointerEvent): PointerInput {
  return {
    kind: pointerKinds[event.type as keyof typeof pointerKinds],
    clientX: event.clientX,
    clientY: event.clientY,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
  };
}

function toScreen(shape: Shape, project: (x: number, y: number) => Screen): Screen[] {
  const outline = outlineOf(shape);
  return Array.from({ length: outline.length >> 1 }, (_, index) =>
    project(at(outline, index * 2), at(outline, index * 2 + 1)),
  );
}

function pathOf(points: readonly Screen[], closed: boolean): string {
  const body = points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  return closed ? `${body} Z` : body;
}

export function useSelectTool(
  engine: ViewerEngine,
  stage: HTMLElement,
  doc: AnnotationDocument,
  onDocumentChange: (next: AnnotationDocument) => void,
  onCommit?: SelectLayerProps["onCommit"],
): SelectTool {
  const latest = useRef({ doc, onDocumentChange, onCommit });
  latest.current = { doc, onDocumentChange, onCommit };
  return useMemo(
    () =>
      createSelectTool({
        document: () => latest.current.doc,
        setDocument: (next) => {
          latest.current = { ...latest.current, doc: next };
          latest.current.onDocumentChange(next);
        },
        toSlide: (point) => slideAt(engine, stage, point),
        pixelSize: () => 1 / screenScale(engine.getCamera()),
        commit: (before, after, label) => latest.current.onCommit?.(before, after, label),
      }),
    [engine, stage],
  );
}

export function SelectLayer({
  engine,
  stage,
  active,
  document: doc,
  onDocumentChange,
  onCommit,
}: SelectLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const tool = useSelectTool(engine, stage, doc, onDocumentChange, onCommit);
  const state = useSyncExternalStore(tool.subscribe, tool.state);
  const escRegistry = useEscRegistry();

  useEffect(() => {
    tool.prune(doc);
  }, [tool, doc]);

  useEffect(() => {
    if (!active) {
      tool.cancel();
      tool.select([]);
      return;
    }
    const pointer = (event: PointerEvent) => {
      const consumed = tool.handle(pointerInput(event));
      if (!consumed) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.type === "pointerdown") {
        interruptMotion(engine);
        capturePointer(stage, event.pointerId);
      }
    };
    const doubleClick = (event: MouseEvent) => {
      const consumed = tool.handle({
        kind: "dblclick",
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        button: event.button,
      });
      if (!consumed) return;
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    const types = Object.keys(pointerKinds);
    for (const type of types) stage.addEventListener(type, pointer as EventListener, true);
    stage.addEventListener("dblclick", doubleClick, true);
    const leaveRung = escRegistry?.add("vertex", {
      open: () => tool.state().gesture !== "idle",
      peel: () => {
        tool.cancel();
      },
    });
    return () => {
      for (const type of types) stage.removeEventListener(type, pointer as EventListener, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      leaveRung?.();
      tool.cancel();
    };
  }, [active, stage, tool, escRegistry, engine]);

  if (!active) return null;

  const project = (x: number, y: number) => slideToScreen(camera, rect, { x, y });
  const selected = state.ids
    .map((id) => doc.shapes.get(id))
    .filter((shape): shape is Shape => shape !== undefined);
  const sole = selected.length === 1 ? selected[0] : undefined;
  const marquee = state.marquee;
  const corner0 = marquee ? project(marquee[0], marquee[1]) : null;
  const corner1 = marquee ? project(marquee[2], marquee[3]) : null;

  return (
    <svg
      data-testid="select-layer"
      data-selected={state.ids.join(",")}
      data-gesture={state.gesture}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {selected.map((shape) => {
        const points = toScreen(shape, project);
        const closed = isClosedKind(shape.kind);
        const path = pathOf(points, closed);
        return (
          <g key={shape.id} data-testid="select-outline" data-shape={shape.id}>
            <path d={path} fill="none" stroke="#fff" strokeWidth={4} strokeLinejoin="round" />
            <path
              d={path}
              fill="none"
              className="stroke-accent"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {sole
        ? handlesOf(sole).map((handle) => {
            const p = project(handle.x, handle.y);
            return (
              <circle
                key={handle.id}
                data-testid="select-handle"
                cx={p.x}
                cy={p.y}
                r={5}
                fill="#fff"
                className="stroke-accent"
                strokeWidth={2}
              />
            );
          })
        : null}
      {corner0 && corner1 ? (
        <rect
          data-testid="select-marquee"
          x={Math.min(corner0.x, corner1.x)}
          y={Math.min(corner0.y, corner1.y)}
          width={Math.abs(corner1.x - corner0.x)}
          height={Math.abs(corner1.y - corner0.y)}
          className="fill-accent/10 stroke-accent"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      ) : null}
    </svg>
  );
}
