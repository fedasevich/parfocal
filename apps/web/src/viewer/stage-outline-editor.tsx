import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { inRing, movedRing, type Ring } from "../annotations/ai-edit.ts";
import type { Point } from "../annotations/polygon-draft.ts";
import {
  crossingEdges,
  insertRingPoint,
  minRingPoints,
  moveRingPoint,
  type RingMidpoint,
  removeRingPoints,
  ringMidpoints,
} from "../annotations/reshape.ts";
import { fastNudgeStepPx, nudgeStepPx } from "../annotations/select-tool.ts";
import { capturePointer, releasePointer, slideAt } from "../annotations/stage-pointer.ts";
import { useStageRect } from "../annotations/stage-size.ts";
import { useEscRegistry } from "../keys/esc-owner.tsx";
import { isTyping } from "../keys/registry.ts";
import { screenScale, slideToScreen, type ViewerEngine } from "./viewer-engine.ts";

const pointHitPx = 10;
const edgeHitPx = 8;

const nudges: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

type Gesture =
  | { readonly kind: "point"; readonly base: Ring; readonly index: number; readonly added: boolean }
  | { readonly kind: "move"; readonly base: Ring; readonly from: Point };

const onChrome = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("button, a, input, textarea, select, section, aside, [role='dialog']") !== null;

const distanceToSegment = (
  at: Point,
  a: readonly [number, number],
  b: readonly [number, number],
) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const share =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - a[0]) * dx + (at.y - a[1]) * dy) / length));
  return Math.hypot(at.x - (a[0] + share * dx), at.y - (a[1] + share * dy));
};

const nearestPoint = (ring: Ring, at: Point, reach: number) => {
  let best = -1;
  let closest = reach;
  ring.forEach(([x, y], index) => {
    const distance = Math.hypot(x - at.x, y - at.y);
    if (distance <= closest) {
      closest = distance;
      best = index;
    }
  });
  return best;
};

const hoveredEdge = (ring: Ring, at: Point, reach: number): RingMidpoint | null => {
  let best: RingMidpoint | null = null;
  let closest = reach;
  for (const midpoint of ringMidpoints(ring)) {
    const a = ring[midpoint.from] ?? [0, 0];
    const b = ring[(midpoint.from + 1) % ring.length] ?? [0, 0];
    const distance = distanceToSegment(at, a, b);
    if (distance <= closest) {
      closest = distance;
      best = midpoint;
    }
  }
  return best;
};

export function StageOutlineEditor({
  engine,
  stage,
  object,
  ring,
  original,
  edited,
  onChange,
  onUndo,
  onRedo,
  onCommit,
  onDiscard,
  onStep,
}: {
  engine: ViewerEngine;
  stage: HTMLElement;
  object: string;
  ring: Ring;
  original: Ring;
  edited: boolean;
  onChange: (ring: Ring) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  onStep: (delta: 1 | -1) => void;
}) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const escRegistry = useEscRegistry();
  const [live, setLive] = useState<Ring | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<RingMidpoint | null>(null);
  const latest = useRef({ ring, selected, onChange, onUndo, onRedo, onCommit, onDiscard, onStep });
  latest.current = { ring, selected, onChange, onUndo, onRedo, onCommit, onDiscard, onStep };

  useEffect(() => {
    const page = stage.ownerDocument;
    let gesture: Gesture | null = null;
    let shown: Ring | null = null;
    let hovered: RingMidpoint | null = null;
    const show = (next: Ring | null) => {
      shown = next;
      setLive(next);
    };
    const hoverOn = (next: RingMidpoint | null) => {
      if (next?.from === hovered?.from) return;
      hovered = next;
      setHover(next);
    };
    const consume = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    const scale = () => screenScale(engine.getCamera());
    const remove = (index: number) => {
      const next = removeRingPoints(latest.current.ring, [index]);
      setSelected(null);
      if (next !== null) latest.current.onChange(next);
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0 || gesture !== null) return;
      if (!(event.target instanceof Node) || !stage.contains(event.target)) return;
      if (onChrome(event.target)) return;
      const ring = latest.current.ring;
      const at = slideAt(engine, stage, event);
      const grab = () => {
        consume(event);
        capturePointer(stage, event.pointerId);
      };
      const index = nearestPoint(ring, at, pointHitPx / scale());
      if (index >= 0) {
        consume(event);
        if (event.altKey) {
          remove(index);
          return;
        }
        setSelected(index);
        gesture = { kind: "point", base: ring, index, added: false };
        capturePointer(stage, event.pointerId);
        return;
      }
      const edge = hoveredEdge(ring, at, edgeHitPx / scale());
      if (edge !== null) {
        const base = insertRingPoint(ring, edge.from, edge.at);
        gesture = { kind: "point", base, index: edge.from + 1, added: true };
        setSelected(edge.from + 1);
        hoverOn(null);
        show(base);
        grab();
        return;
      }
      if (inRing(ring, at)) {
        gesture = { kind: "move", base: ring, from: at };
        grab();
      }
    };

    const move = (event: PointerEvent) => {
      const at = slideAt(engine, stage, event);
      if (gesture === null) {
        const ring = latest.current.ring;
        const onPoint = nearestPoint(ring, at, pointHitPx / scale()) >= 0;
        hoverOn(onPoint ? null : hoveredEdge(ring, at, edgeHitPx / scale()));
        return;
      }
      consume(event);
      show(
        gesture.kind === "point"
          ? moveRingPoint(gesture.base, gesture.index, at)
          : movedRing(gesture.base, at.x - gesture.from.x, at.y - gesture.from.y),
      );
    };

    const up = (event: PointerEvent) => {
      const done = gesture;
      gesture = null;
      if (done === null) return;
      consume(event);
      releasePointer(stage, event.pointerId);
      const next = shown;
      show(null);
      if (event.type !== "pointerup") return;
      if (next !== null) latest.current.onChange(next);
      else if (done.kind === "point" && done.added) latest.current.onChange(done.base);
    };

    const key = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      const now = latest.current;
      const take = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const letter = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && letter === "z" && !event.altKey) {
        take();
        if (event.shiftKey) now.onRedo();
        else now.onUndo();
        return;
      }
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      if (letter === "j") {
        take();
        now.onStep(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Enter") {
        if (onChrome(event.target)) return;
        take();
        now.onCommit();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        take();
        if (now.selected !== null) remove(now.selected);
        return;
      }
      const step = nudges[event.key];
      if (step === undefined) return;
      take();
      const size = (event.shiftKey ? fastNudgeStepPx : nudgeStepPx) / scale();
      const [dx, dy] = [step[0] * size, step[1] * size];
      const point = now.selected === null ? undefined : now.ring[now.selected];
      now.onChange(
        point === undefined || now.selected === null
          ? movedRing(now.ring, dx, dy)
          : moveRingPoint(now.ring, now.selected, { x: point[0] + dx, y: point[1] + dy }),
      );
    };

    page.addEventListener("pointerdown", down, true);
    page.addEventListener("pointermove", move, true);
    page.addEventListener("pointerup", up, true);
    page.addEventListener("pointercancel", up, true);
    window.addEventListener("keydown", key, true);
    const leave = escRegistry?.add("vertex", {
      open: () => true,
      peel: () => latest.current.onDiscard(),
    });
    return () => {
      page.removeEventListener("pointerdown", down, true);
      page.removeEventListener("pointermove", move, true);
      page.removeEventListener("pointerup", up, true);
      page.removeEventListener("pointercancel", up, true);
      window.removeEventListener("keydown", key, true);
      leave?.();
    };
  }, [stage, engine, escRegistry]);

  const shown = live ?? ring;
  const crossing = useMemo(() => crossingEdges(shown), [shown]);
  const crossed = useMemo(() => new Set(crossing), [crossing]);
  const project = ([x, y]: readonly [number, number]) => slideToScreen(camera, rect, { x, y });
  const pointsOf = (points: Ring) =>
    points
      .map((point) => {
        const at = project(point);
        return `${at.x},${at.y}`;
      })
      .join(" ");
  const chosen = selected !== null && selected < shown.length ? selected : null;
  const ghost = hover === null ? null : project([hover.at.x, hover.at.y]);
  return (
    <svg
      data-testid="outline-editor"
      data-editing={object}
      data-points={shown.length}
      data-crossing={crossing.length}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {edited ? (
        <polygon
          data-testid="outline-original"
          points={pointsOf(original)}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.6}
        />
      ) : null}
      <polygon
        data-testid="outline-draft"
        points={pointsOf(shown)}
        fill="var(--accent)"
        fillOpacity={0.12}
        stroke="var(--accent)"
        strokeWidth={2}
      />
      {crossing.map((from) => {
        const a = project(shown[from] ?? [0, 0]);
        const b = project(shown[(from + 1) % shown.length] ?? [0, 0]);
        return (
          <line
            key={from}
            data-testid="outline-crossing-edge"
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--bad)"
            strokeWidth={3}
          />
        );
      })}
      {ghost !== null && shown.length >= minRingPoints ? (
        <circle
          data-testid="outline-midpoint"
          cx={ghost.x}
          cy={ghost.y}
          r={4}
          fill="var(--chrome)"
          stroke="var(--accent)"
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />
      ) : null}
      {shown.map((point, index) => {
        const at = project(point);
        const picked = index === chosen;
        return (
          <circle
            key={`${point[0]}:${point[1]}`}
            data-testid="outline-point"
            data-index={index}
            data-selected={picked ? "true" : "false"}
            data-crossing={
              crossed.has(index) || crossed.has((index + shown.length - 1) % shown.length)
                ? "true"
                : "false"
            }
            cx={at.x}
            cy={at.y}
            r={picked ? 5 : 4}
            fill={picked ? "var(--accent)" : "var(--chrome)"}
            stroke="var(--accent)"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}
