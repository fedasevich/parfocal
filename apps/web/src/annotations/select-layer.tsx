import type { PointerInput } from "@parfocal/viewer-engine";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { isTyping } from "../keys/registry.ts";
import type { ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, slideToScreen } from "../viewer/viewer-engine.ts";
import type { AnnotationDocument } from "./document.ts";
import { handlesOf, isReshapable } from "./reshape.ts";
import {
  createSelectTool,
  fastNudgeStepPx,
  type Hover,
  nudgeStepPx,
  type SelectTool,
} from "./select-tool.ts";
import { at, type Extent, isClosedKind, outlineOf, type Shape, type ShapeId } from "./shapes.ts";
import { bindSpacePan, capturePointer, interruptMotion, slideAt } from "./stage-pointer.ts";
import { useStageRect } from "./stage-size.ts";

type SelectLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  active: boolean;
  document: AnnotationDocument;
  onDocumentChange: (next: AnnotationDocument) => void;
  onCommit?: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
  onEditText?: (id: ShapeId) => void;
};

type Screen = { x: number; y: number };

const pointerKinds = {
  pointerdown: "down",
  pointermove: "move",
  pointerup: "up",
  pointercancel: "cancel",
  lostpointercapture: "lostcapture",
} as const;

const nudgeKeys: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const cursorOf = (hover: Hover | null): string => {
  if (hover === null || hover.kind === "shape") return "default";
  return "crosshair";
};

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

function unionOf(shapes: readonly Shape[]): Extent | null {
  if (shapes.length === 0) return null;
  return shapes.reduce<Extent>(
    (whole, shape) => [
      Math.min(whole[0], shape.bounds[0]),
      Math.min(whole[1], shape.bounds[1]),
      Math.max(whole[2], shape.bounds[2]),
      Math.max(whole[3], shape.bounds[3]),
    ],
    [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ],
  );
}

export function useSelectTool(
  engine: ViewerEngine,
  stage: HTMLElement,
  doc: AnnotationDocument,
  onDocumentChange: (next: AnnotationDocument) => void,
  onCommit?: SelectLayerProps["onCommit"],
  onEditText?: SelectLayerProps["onEditText"],
): SelectTool {
  const latest = useRef({ doc, onDocumentChange, onCommit, onEditText });
  latest.current = { doc, onDocumentChange, onCommit, onEditText };
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
        editText: (id) => latest.current.onEditText?.(id),
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
  onEditText,
}: SelectLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const tool = useSelectTool(engine, stage, doc, onDocumentChange, onCommit, onEditText);
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
    const pan = bindSpacePan(stage, {
      engine: () => engine,
      gesturing: () => tool.state().gesture !== "idle",
    });
    const pointer = (event: PointerEvent) => {
      if (event.type === "pointerdown" && pan.held()) return;
      if (event.type === "pointermove") {
        if (pan.steer(event)) {
          event.stopImmediatePropagation();
          return;
        }
        if (tool.state().gesture === "idle") pan.track(event);
      }
      if (event.type === "pointerup" || event.type === "pointercancel") pan.release();
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
    const key = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey) return;
      const current = tool.state();
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        tool.selectAll();
        return;
      }
      if (command && event.key.toLowerCase() === "g") {
        const done = event.shiftKey ? tool.ungroupSelected() : tool.groupSelected();
        if (!done) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (command) return;
      if (event.key === "Enter") {
        if (current.gesture !== "idle") return;
        const [only, ...rest] = current.ids;
        if (current.editing !== null) tool.edit(null);
        else if (only !== undefined && rest.length === 0) tool.edit(only);
        else return;
        event.preventDefault();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        if (!tool.removeSelected()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const step = nudgeKeys[event.key];
      if (step === undefined || current.gesture !== "idle") return;
      const size = event.shiftKey ? fastNudgeStepPx : nudgeStepPx;
      if (!tool.nudge(step[0] * size, step[1] * size)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const types = Object.keys(pointerKinds);
    for (const type of types) stage.addEventListener(type, pointer as EventListener, true);
    stage.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key, true);
    const leaveVertex = escRegistry?.add("vertex", {
      open: () => tool.state().gesture !== "idle" || tool.state().editing !== null,
      peel: () => {
        if (!tool.cancel()) tool.edit(null);
      },
    });
    const leaveSelection = escRegistry?.add("selection", {
      open: () => tool.state().ids.length > 0,
      peel: () => tool.select([]),
    });
    const savedCursor = stage.style.cursor;
    return () => {
      for (const type of types) stage.removeEventListener(type, pointer as EventListener, true);
      stage.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key, true);
      pan.dispose();
      leaveVertex?.();
      leaveSelection?.();
      tool.cancel();
      stage.style.cursor = savedCursor;
    };
  }, [active, stage, tool, escRegistry, engine]);

  useEffect(() => {
    if (!active) return;
    stage.style.cursor = cursorOf(state.hover);
  }, [active, stage, state.hover]);

  if (!active) return null;

  const project = (x: number, y: number) => slideToScreen(camera, rect, { x, y });
  const selected = state.ids
    .map((id) => doc.shapes.get(id))
    .filter((shape): shape is Shape => shape !== undefined);
  const editing = state.editing === null ? undefined : doc.shapes.get(state.editing);
  const sole = editing ?? (selected.length === 1 ? selected[0] : undefined);
  const handled = sole && isReshapable(sole) ? sole : undefined;
  const marquee = state.marquee;
  const corner0 = marquee ? project(marquee[0], marquee[1]) : null;
  const corner1 = marquee ? project(marquee[2], marquee[3]) : null;
  const group = selected.length > 1 ? unionOf(selected) : null;
  const group0 = group ? project(group[0], group[1]) : null;
  const group1 = group ? project(group[2], group[3]) : null;
  const hover = state.hover;
  const hovered =
    hover?.kind === "shape" && !state.ids.includes(hover.id) ? doc.shapes.get(hover.id) : undefined;
  const midpoint = hover?.kind === "midpoint" ? project(hover.at.x, hover.at.y) : null;

  return (
    <svg
      data-testid="select-layer"
      data-selected={state.ids.join(",")}
      data-gesture={state.gesture}
      data-editing={state.editing ?? ""}
      data-vertices={state.vertices.join(",")}
      data-hover={hover?.kind ?? ""}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {hovered ? (
        <path
          data-testid="select-hover"
          d={pathOf(toScreen(hovered, project), isClosedKind(hovered.kind))}
          fill="none"
          className="stroke-accent"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ) : null}
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
      {group0 && group1 ? (
        <rect
          data-testid="select-group"
          x={Math.min(group0.x, group1.x) - 4}
          y={Math.min(group0.y, group1.y) - 4}
          width={Math.abs(group1.x - group0.x) + 8}
          height={Math.abs(group1.y - group0.y) + 8}
          fill="none"
          className="stroke-accent"
          strokeWidth={1}
        />
      ) : null}
      {handled
        ? handlesOf(handled).map((handle) => {
            const p = project(handle.x, handle.y);
            const chosen = state.editing !== null && state.vertices.includes(handle.id);
            return (
              <circle
                key={handle.id}
                data-testid="select-handle"
                data-selected={chosen ? "true" : "false"}
                cx={p.x}
                cy={p.y}
                r={5}
                fill={chosen ? "currentColor" : "#fff"}
                className={chosen ? "stroke-accent text-accent" : "stroke-accent"}
                strokeWidth={2}
              />
            );
          })
        : null}
      {midpoint ? (
        <circle
          data-testid="select-midpoint"
          cx={midpoint.x}
          cy={midpoint.y}
          r={4}
          fill="#fff"
          className="stroke-accent opacity-70"
          strokeWidth={1.5}
        />
      ) : null}
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
