import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { isTyping } from "../keys/registry.ts";
import type { Camera, ViewerEngine } from "../viewer/viewer-engine.ts";
import { screenScale, slideToScreen } from "../viewer/viewer-engine.ts";
import {
  type AiCell,
  cellsInLasso,
  hitCell,
  maxHandles,
  movedRing,
  type PickMode,
  type Ring,
  simplifyRing,
  withVertex,
} from "./ai-edit.ts";
import type { CheckState } from "./check-state.ts";
import type { Point } from "./polygon-draft.ts";
import { fastNudgeStepPx, hitTolerancePx, nudgeStepPx } from "./select-tool.ts";
import type { Extent } from "./shapes.ts";
import { capturePointer, releasePointer, slideAt } from "./stage-pointer.ts";
import { type StageRect, useStageRect } from "./stage-size.ts";

type AiLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  cells: readonly AiCell[];
  checkOf: (object: string) => CheckState;
  selection: readonly string[];
  selecting: boolean;
  locked: boolean;
  tag: string | null;
  colourOf: (classKey: string | null) => string;
  onPick: (ids: readonly string[], mode: PickMode) => void;
  onReshape: (object: string, ring: Ring) => void;
  onDelete: () => void;
  onStep: (delta: 1 | -1) => void;
};

type Gesture =
  | { kind: "empty"; x: number; y: number; shift: boolean }
  | { kind: "press"; object: string; x: number; y: number; from: Point; shift: boolean }
  | { kind: "move"; object: string; base: Ring; from: Point }
  | { kind: "vertex"; object: string; base: Ring; index: number }
  | { kind: "lasso"; path: Point[]; add: boolean };

type Draft = { readonly object: string; readonly ring: Ring };

const dragStartPx = 4;
const areaViews = 3;
const shrinkViews = 6;
const deepShare = 4;

const viewArea = (camera: Camera, rect: StageRect): Extent => {
  const scale = screenScale(camera);
  const width = Math.max(rect.width, 1) / scale;
  const height = Math.max(rect.height, 1) / scale;
  return [camera.x - width / 2, camera.y - height / 2, camera.x + width / 2, camera.y + height / 2];
};

const around = (view: Extent): Extent => {
  const width = ((view[2] - view[0]) * (areaViews - 1)) / 2;
  const height = ((view[3] - view[1]) * (areaViews - 1)) / 2;
  return [view[0] - width, view[1] - height, view[2] + width, view[3] + height];
};

const covers = (area: Extent, view: Extent) =>
  area[0] <= view[0] &&
  area[1] <= view[1] &&
  area[2] >= view[2] &&
  area[3] >= view[3] &&
  area[2] - area[0] <= (view[2] - view[0]) * shrinkViews;
const handleHitPx = 10;

const nudges: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const onChrome = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("button, a, input, textarea, select, section, aside, [role='dialog']") !== null;

type CellOutlinesProps = {
  shown: readonly AiCell[];
  chosen: ReadonlySet<string>;
  checkOf: (object: string) => CheckState;
  colourOf: (classKey: string | null) => string;
  draft: Draft | null;
};

const slideTransform = (camera: Camera, rect: StageRect) => {
  const scale = screenScale(camera);
  const origin = slideToScreen(camera, rect, { x: 0, y: 0 });
  return `matrix(${scale} 0 0 ${scale} ${origin.x} ${origin.y})`;
};

const ringPoints = (ring: Ring) => ring.map(([x, y]) => `${x},${y}`).join(" ");

const CellOutline = memo(function CellOutline({
  cell,
  ring,
  picked,
  check,
  colour,
}: {
  cell: AiCell;
  ring: Ring;
  picked: boolean;
  check: CheckState;
  colour: string;
}) {
  const points = useMemo(() => ringPoints(ring), [ring]);
  return (
    <polygon
      data-testid="ai-object"
      data-object={cell.object}
      data-check={check}
      data-class={cell.classId ?? ""}
      data-selected={picked ? "true" : "false"}
      points={points}
      fill={picked ? colour : "none"}
      fillOpacity={picked ? 0.18 : undefined}
      stroke={colour}
      strokeWidth={picked ? 3 : 1.5}
      strokeDasharray={check === "unchecked" && !cell.edited ? "4 3" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
});

const CellOutlines = memo(function CellOutlines({
  shown,
  chosen,
  checkOf,
  colourOf,
  draft,
}: CellOutlinesProps) {
  return shown.map((cell) => (
    <CellOutline
      key={cell.object}
      cell={cell}
      ring={draft?.object === cell.object ? draft.ring : cell.ring}
      picked={chosen.has(cell.object)}
      check={checkOf(cell.object)}
      colour={colourOf(cell.classId)}
    />
  ));
});

const handlesFor = (ring: Ring): Ring => (ring.length > maxHandles ? simplifyRing(ring) : ring);

export function AiLayer({
  engine,
  stage,
  cells,
  checkOf,
  selection,
  selecting,
  locked,
  tag,
  colourOf,
  onPick,
  onReshape,
  onDelete,
  onStep,
}: AiLayerProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const escRegistry = useEscRegistry();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lasso, setLasso] = useState<readonly Point[] | null>(null);
  const chosen = useMemo(() => new Set(selection), [selection]);
  const sole = selection.length === 1 ? cells.find((cell) => cell.object === selection[0]) : null;
  const edited = editing === null ? null : (cells.find((cell) => cell.object === editing) ?? null);
  const editedRing = edited?.ring ?? null;
  const editRing = useMemo(
    () => (editedRing === null ? null : handlesFor(editedRing)),
    [editedRing],
  );
  const latest = useRef({
    cells,
    selection,
    locked,
    editing,
    editRing,
    onPick,
    onReshape,
    onDelete,
    onStep,
  });
  latest.current = {
    cells,
    selection,
    locked,
    editing,
    editRing,
    onPick,
    onReshape,
    onDelete,
    onStep,
  };

  useEffect(() => {
    if (editing !== null && (selection.length !== 1 || selection[0] !== editing)) setEditing(null);
  }, [editing, selection]);

  useEffect(() => {
    if (draft !== null && !cells.some((cell) => cell.object === draft.object)) setDraft(null);
  }, [draft, cells]);

  useEffect(() => {
    if (!selecting) {
      setEditing(null);
      setDraft(null);
      setLasso(null);
      return;
    }
    const page = stage.ownerDocument;
    let gesture: Gesture | null = null;
    let live: Draft | null = null;
    const show = (next: Draft | null) => {
      live = next;
      setDraft(next);
    };
    const consume = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const scale = () => screenScale(engine.getCamera());
    const cellNamed = (object: string) =>
      latest.current.cells.find((cell) => cell.object === object);

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || gesture !== null) return;
      if (!(event.target instanceof Node) || !stage.contains(event.target)) return;
      if (onChrome(event.target)) return;
      const now = latest.current;
      const at = slideAt(engine, stage, event);
      const grab = () => {
        consume(event);
        capturePointer(stage, event.pointerId);
      };
      if (now.editing !== null && now.editRing !== null && !now.locked) {
        const reach = handleHitPx / scale();
        const index = now.editRing.findIndex(([x, y]) => Math.hypot(x - at.x, y - at.y) <= reach);
        if (index >= 0) {
          gesture = { kind: "vertex", object: now.editing, base: now.editRing, index };
          grab();
          return;
        }
      }
      if (event.altKey) {
        gesture = { kind: "lasso", path: [at], add: event.shiftKey };
        setLasso([at]);
        grab();
        return;
      }
      const hit = hitCell(now.cells, at, hitTolerancePx / scale());
      if (hit === null) {
        gesture = { kind: "empty", x: event.clientX, y: event.clientY, shift: event.shiftKey };
        return;
      }
      gesture = {
        kind: "press",
        object: hit.object,
        x: event.clientX,
        y: event.clientY,
        from: at,
        shift: event.shiftKey,
      };
      grab();
    };

    const move = (event: PointerEvent) => {
      if (gesture === null || gesture.kind === "empty") return;
      consume(event);
      const now = latest.current;
      const at = slideAt(engine, stage, event);
      if (gesture.kind === "press") {
        const far = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > dragStartPx;
        const only = now.selection.length === 1 && now.selection[0] === gesture.object;
        const cell = cellNamed(gesture.object);
        if (!far || !only || now.locked || cell === undefined) return;
        gesture = { kind: "move", object: gesture.object, base: cell.ring, from: gesture.from };
      }
      if (gesture.kind === "move") {
        show({
          object: gesture.object,
          ring: movedRing(gesture.base, at.x - gesture.from.x, at.y - gesture.from.y),
        });
      } else if (gesture.kind === "vertex") {
        show({ object: gesture.object, ring: withVertex(gesture.base, gesture.index, at) });
      } else if (gesture.kind === "lasso") {
        gesture.path.push(at);
        setLasso([...gesture.path]);
      }
    };

    const up = (event: PointerEvent) => {
      const done = gesture;
      gesture = null;
      if (done === null) return;
      const now = latest.current;
      if (done.kind === "empty") {
        const still = Math.hypot(event.clientX - done.x, event.clientY - done.y) <= dragStartPx;
        if (still && !done.shift && event.type === "pointerup") now.onPick([], "replace");
        return;
      }
      consume(event);
      releasePointer(stage, event.pointerId);
      if (event.type !== "pointerup") {
        show(null);
        setLasso(null);
        return;
      }
      if (done.kind === "press") {
        now.onPick([done.object], done.shift ? "toggle" : "replace");
      } else if (done.kind === "lasso") {
        setLasso(null);
        now.onPick(cellsInLasso(now.cells, done.path), done.add ? "add" : "replace");
      } else if (live !== null) {
        now.onReshape(live.object, live.ring);
        show(null);
      }
    };

    const doubleClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !stage.contains(event.target)) return;
      if (onChrome(event.target)) return;
      const now = latest.current;
      const hit = hitCell(now.cells, slideAt(engine, stage, event), hitTolerancePx / scale());
      if (hit === null) return;
      consume(event);
      now.onPick([hit.object], "replace");
      if (!now.locked) setEditing(hit.object);
    };

    const key = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.altKey || event.metaKey || event.ctrlKey) return;
      const now = latest.current;
      const take = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const letter = event.key.toLowerCase();
      if (letter === "j" && now.cells.length > 0) {
        take();
        now.onStep(event.shiftKey ? -1 : 1);
        return;
      }
      if (now.selection.length === 0) return;
      if (event.key === "Enter" && now.selection.length === 1 && !now.locked) {
        take();
        setEditing((current) => (current === null ? (now.selection[0] ?? null) : null));
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace" || letter === "x") && !now.locked) {
        take();
        now.onDelete();
        return;
      }
      const step = nudges[event.key];
      const cell = now.editing === null ? undefined : cellNamed(now.editing);
      if (step === undefined || cell === undefined || now.locked) return;
      take();
      const size = (event.shiftKey ? fastNudgeStepPx : nudgeStepPx) / scale();
      now.onReshape(cell.object, movedRing(cell.ring, step[0] * size, step[1] * size));
    };

    page.addEventListener("pointerdown", down, true);
    page.addEventListener("pointermove", move, true);
    page.addEventListener("pointerup", up, true);
    page.addEventListener("pointercancel", up, true);
    page.addEventListener("dblclick", doubleClick, true);
    window.addEventListener("keydown", key, true);
    const leaveHandles = escRegistry?.add("vertex", {
      open: () => latest.current.editing !== null,
      peel: () => setEditing(null),
    });
    const leaveSelection = escRegistry?.add("selection", {
      open: () => latest.current.selection.length > 0,
      peel: () => latest.current.onPick([], "replace"),
    });
    return () => {
      page.removeEventListener("pointerdown", down, true);
      page.removeEventListener("pointermove", move, true);
      page.removeEventListener("pointerup", up, true);
      page.removeEventListener("pointercancel", up, true);
      page.removeEventListener("dblclick", doubleClick, true);
      window.removeEventListener("keydown", key, true);
      leaveHandles?.();
      leaveSelection?.();
    };
  }, [selecting, stage, engine, escRegistry]);

  const project = ([x, y]: readonly [number, number]) => slideToScreen(camera, rect, { x, y });
  const pointsOf = (ring: Ring) =>
    ring
      .map((point) => {
        const at = project(point);
        return `${at.x},${at.y}`;
      })
      .join(" ");
  const shown = useMemo(() => cells.filter((cell) => !cell.deleted), [cells]);
  const view = viewArea(camera, rect);
  const [kept, keep] = useState<Extent | null>(null);
  const area = kept !== null && covers(kept, view) ? kept : around(view);
  if (area !== kept) keep(area);
  const draftObject = draft?.object ?? null;
  const near = useMemo(() => {
    const inside = shown.filter(
      (cell) =>
        chosen.has(cell.object) ||
        cell.object === draftObject ||
        (cell.bounds[2] >= area[0] &&
          cell.bounds[0] <= area[2] &&
          cell.bounds[3] >= area[1] &&
          cell.bounds[1] <= area[3]),
    );
    return inside.length === shown.length ? shown : inside;
  }, [shown, chosen, draftObject, area]);
  const deep = near.length * deepShare <= shown.length;
  const handles = edited === null ? null : draft?.object === edited.object ? draft.ring : editRing;
  const tagAt =
    sole && !sole.deleted && tag !== null
      ? project([sole.bounds[0], sole.bounds[1]] as const)
      : null;

  return (
    <>
      <svg
        data-testid="ai-layer"
        data-objects={shown.length}
        data-selected={selection.length}
        data-editing={editing ?? ""}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <g
          data-testid="ai-cells"
          data-drawn={deep ? near.length : shown.length}
          transform={slideTransform(camera, rect)}
        >
          <g display={deep ? "none" : undefined}>
            <CellOutlines
              shown={shown}
              chosen={chosen}
              checkOf={checkOf}
              colourOf={colourOf}
              draft={draft}
            />
          </g>
          {deep ? (
            <CellOutlines
              shown={near}
              chosen={chosen}
              checkOf={checkOf}
              colourOf={colourOf}
              draft={draft}
            />
          ) : null}
        </g>
        {sole?.edited && !sole.deleted ? (
          <polygon
            data-testid="ai-ghost"
            points={pointsOf(sole.original.ring)}
            fill="none"
            stroke={colourOf(sole.original.classId)}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.8}
          />
        ) : null}
        {handles?.map((point) => {
          const at = project(point);
          return (
            <circle
              key={`${point[0]}:${point[1]}`}
              data-testid="ai-handle"
              cx={at.x}
              cy={at.y}
              r={4}
              fill="var(--chrome)"
              stroke="var(--accent)"
              strokeWidth={1.5}
            />
          );
        })}
        {lasso ? (
          <polyline
            data-testid="ai-lasso"
            points={lasso.map((point) => pointsOf([[point.x, point.y]])).join(" ")}
            fill="var(--accent)"
            fillOpacity={0.08}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
          />
        ) : null}
      </svg>
      {tagAt ? (
        <span
          data-testid="ai-tag"
          className="pointer-events-none absolute -translate-y-full whitespace-nowrap rounded-md border border-line bg-chrome px-1.5 py-0.5 text-body-sm text-fg"
          style={{ left: tagAt.x, top: tagAt.y - 6 }}
        >
          {tag}
        </span>
      ) : null}
    </>
  );
}
