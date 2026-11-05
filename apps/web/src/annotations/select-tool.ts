import type { DoubleClickInput, InputPoint, PointerInput } from "@parfocal/viewer-engine";
import { minimumDragScreenPixels, type Point, snapToAngle } from "../measure/ruler-maths.ts";
import { type AnnotationDocument, moveShape, updateShape } from "./document.ts";
import { extentOfCorners, pickShape, projectOnSegment, shapesInExtent } from "./hit-test.ts";
import {
  canInsertVertex,
  canRemoveVertex,
  type Edge,
  edgesOf,
  type Handle,
  handlesOf,
  insertVertex,
  moveEdge,
  moveHandle,
  neighbourOf,
  removeVertex,
} from "./reshape.ts";
import type { Extent, Geometry, Shape, ShapeId } from "./shapes.ts";

export const hitTolerancePx = 6;
export const handleRadiusPx = 8;

export type SelectGesture = "idle" | "press" | "move" | "marquee" | "vertex" | "edge";

export interface SelectState {
  readonly ids: readonly ShapeId[];
  readonly gesture: SelectGesture;
  readonly marquee: Extent | null;
}

export interface SelectHost {
  readonly document: () => AnnotationDocument;
  readonly setDocument: (next: AnnotationDocument) => void;
  readonly toSlide: (at: InputPoint) => Point;
  readonly pixelSize: () => number;
  readonly commit?: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
}

export type SelectInput = PointerInput | DoubleClickInput;

export interface SelectTool {
  readonly handle: (input: SelectInput) => boolean;
  readonly cancel: () => boolean;
  readonly state: () => SelectState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly select: (ids: readonly ShapeId[]) => void;
  readonly prune: (doc?: AnnotationDocument) => void;
}

type Press = {
  readonly pointerId: number;
  readonly screen: Point;
  readonly slide: Point;
  readonly base: AnnotationDocument;
  readonly baseIds: readonly ShapeId[];
  readonly shift: boolean;
  moved: boolean;
};

type Gesture =
  | (Press & { readonly kind: "shape"; readonly shapeId: ShapeId; readonly wasSelected: boolean })
  | (Press & { readonly kind: "empty" })
  | (Press & { readonly kind: "vertex"; readonly shapeId: ShapeId; readonly handle: Handle })
  | (Press & { readonly kind: "edge"; readonly shapeId: ShapeId; readonly edge: Edge });

const idle: SelectState = { ids: [], gesture: "idle", marquee: null };

function sameIds(a: readonly ShapeId[], b: readonly ShapeId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sorted(ids: Iterable<ShapeId>): ShapeId[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function lockAxis(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

export function createSelectTool(host: SelectHost): SelectTool {
  let state: SelectState = idle;
  let gesture: Gesture | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<SelectState>) => {
    const next = { ...state, ...patch };
    const changed =
      !sameIds(next.ids, state.ids) ||
      next.gesture !== state.gesture ||
      next.marquee !== state.marquee;
    if (!changed) return;
    state = sameIds(next.ids, state.ids) ? { ...next, ids: state.ids } : next;
    for (const listener of listeners) listener();
  };

  const screenOf = (input: InputPoint): Point => ({ x: input.clientX, y: input.clientY });
  const handleRadius = () => handleRadiusPx * host.pixelSize();
  const tolerance = () => hitTolerancePx * host.pixelSize();

  const soleShape = (): Shape | null => {
    const [only, ...rest] = state.ids;
    if (only === undefined || rest.length > 0) return null;
    return host.document().shapes.get(only) ?? null;
  };

  const handleAt = (shape: Shape, p: Point): Handle | null => {
    let best: Handle | null = null;
    let bestDistance = handleRadius();
    for (const handle of handlesOf(shape)) {
      const distance = Math.hypot(handle.x - p.x, handle.y - p.y);
      if (distance <= bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best;
  };

  const edgeAt = (shape: Shape, p: Point) => {
    let best: { edge: Edge; at: Point } | null = null;
    let bestDistance = tolerance();
    for (const edge of edgesOf(shape)) {
      const projection = projectOnSegment(p, edge.a, edge.b);
      if (projection.distance <= bestDistance) {
        best = { edge, at: projection.point };
        bestDistance = projection.distance;
      }
    }
    return best;
  };

  const startPress = (input: PointerInput): Press => ({
    pointerId: input.pointerId,
    screen: screenOf(input),
    slide: host.toSlide(input),
    base: host.document(),
    baseIds: state.ids,
    shift: input.shiftKey,
    moved: false,
  });

  const down = (input: PointerInput): boolean => {
    if (input.button !== 0) return false;
    if (gesture !== null) return true;
    const press = startPress(input);
    const sole = soleShape();
    if (sole) {
      const handle = handleAt(sole, press.slide);
      if (handle) {
        gesture = { ...press, kind: "vertex", shapeId: sole.id, handle };
        set({ gesture: "press" });
        return true;
      }
      const edge = edgeAt(sole, press.slide);
      if (edge) {
        gesture = { ...press, kind: "edge", shapeId: sole.id, edge: edge.edge };
        set({ gesture: "press" });
        return true;
      }
    }
    const hit = pickShape(press.base, press.slide, tolerance());
    if (hit) {
      const wasSelected = state.ids.includes(hit.id);
      gesture = { ...press, kind: "shape", shapeId: hit.id, wasSelected };
      set({ gesture: "press", ids: wasSelected || press.shift ? state.ids : [hit.id] });
      return true;
    }
    gesture = { ...press, kind: "empty" };
    set({ gesture: "press" });
    return true;
  };

  const slideDelta = (current: Gesture, at: Point, shift: boolean): Point => {
    const target = shift ? lockAxis(current.slide, at) : at;
    return { x: target.x - current.slide.x, y: target.y - current.slide.y };
  };

  const applyMove = (current: Extract<Gesture, { kind: "shape" }>, at: Point, shift: boolean) => {
    const delta = slideDelta(current, at, shift);
    let next = current.base;
    for (const id of state.ids) {
      if (current.base.shapes.has(id)) next = moveShape(next, id, delta.x, delta.y).document;
    }
    host.setDocument(next);
  };

  const applyVertex = (
    current: Extract<Gesture, { kind: "vertex" }>,
    at: Point,
    shift: boolean,
  ) => {
    const shape = current.base.shapes.get(current.shapeId);
    if (!shape) return;
    const carried = {
      x: current.handle.x + at.x - current.slide.x,
      y: current.handle.y + at.y - current.slide.y,
    };
    const anchor = shift ? neighbourOf(shape, current.handle.id) : null;
    const target = anchor ? snapToAngle(anchor, carried) : carried;
    const geometry = moveHandle(shape, current.handle.id, target);
    host.setDocument(updateShape(current.base, shape.id, { geometry }).document);
  };

  const applyEdge = (current: Extract<Gesture, { kind: "edge" }>, at: Point, shift: boolean) => {
    const shape = current.base.shapes.get(current.shapeId);
    if (!shape) return;
    const target = shift ? snapToAngle(current.slide, at) : at;
    const geometry = moveEdge(
      shape,
      current.edge,
      target.x - current.slide.x,
      target.y - current.slide.y,
    );
    host.setDocument(updateShape(current.base, shape.id, { geometry }).document);
  };

  const applyMarquee = (current: Gesture, at: Point) => {
    const area = extentOfCorners(current.slide, at);
    const inside = shapesInExtent(current.base, area).map((shape) => shape.id);
    set({
      gesture: "marquee",
      marquee: area,
      ids: sorted(current.shift ? [...current.baseIds, ...inside] : inside),
    });
  };

  const move = (input: PointerInput): boolean => {
    const current = gesture;
    if (current === null || input.pointerId !== current.pointerId) return false;
    const travelled = Math.hypot(
      input.clientX - current.screen.x,
      input.clientY - current.screen.y,
    );
    if (!current.moved && travelled < minimumDragScreenPixels) return true;
    const at = host.toSlide(input);
    if (!current.moved) {
      current.moved = true;
      if (current.kind === "shape" && !state.ids.includes(current.shapeId)) {
        set({ ids: [current.shapeId] });
      }
    }
    switch (current.kind) {
      case "shape":
        set({ gesture: "move" });
        applyMove(current, at, input.shiftKey);
        break;
      case "vertex":
        set({ gesture: "vertex" });
        applyVertex(current, at, input.shiftKey);
        break;
      case "edge":
        set({ gesture: "edge" });
        applyEdge(current, at, input.shiftKey);
        break;
      case "empty":
        applyMarquee(current, at);
        break;
    }
    return true;
  };

  const finishClick = (current: Gesture) => {
    if (current.kind === "shape") {
      if (current.shift) {
        const ids = current.wasSelected
          ? state.ids.filter((id) => id !== current.shapeId)
          : [...state.ids, current.shapeId];
        set({ ids: sorted(ids) });
      } else if (current.wasSelected && state.ids.length > 1) {
        set({ ids: [current.shapeId] });
      }
    }
    if (current.kind === "empty" && !current.shift) set({ ids: [] });
  };

  const labelOf: Record<Gesture["kind"], string> = {
    shape: "Move",
    vertex: "Reshape",
    edge: "Reshape",
    empty: "Select",
  };

  const up = (input: PointerInput): boolean => {
    const current = gesture;
    if (current === null || input.pointerId !== current.pointerId) return false;
    gesture = null;
    if (!current.moved) finishClick(current);
    set({ gesture: "idle", marquee: null });
    if (current.moved && current.kind !== "empty") {
      const after = host.document();
      if (after !== current.base) host.commit?.(current.base, after, labelOf[current.kind]);
    }
    return true;
  };

  const abort = (): boolean => {
    const current = gesture;
    if (current === null) return false;
    gesture = null;
    if (current.moved && current.kind !== "empty") host.setDocument(current.base);
    set({ gesture: "idle", marquee: null, ids: current.baseIds });
    return true;
  };

  const doubleClick = (input: DoubleClickInput): boolean => {
    if (input.button !== 0) return false;
    const at = host.toSlide(input);
    const sole = soleShape();
    if (sole) {
      const handle = handleAt(sole, at);
      if (handle) {
        if (canRemoveVertex(sole)) apply(sole, removeVertex(sole, handle.id), "Remove point");
        return true;
      }
      const edge = edgeAt(sole, at);
      if (edge) {
        if (canInsertVertex(sole)) {
          apply(sole, insertVertex(sole, edge.edge, edge.at), "Add point");
        }
        return true;
      }
    }
    return pickShape(host.document(), at, tolerance()) !== null;
  };

  const apply = (shape: Shape, geometry: Geometry, label: string) => {
    const before = host.document();
    const after = updateShape(before, shape.id, { geometry }).document;
    host.setDocument(after);
    host.commit?.(before, after, label);
  };

  return {
    handle(input) {
      switch (input.kind) {
        case "down":
          return down(input);
        case "move":
          return move(input);
        case "up":
          return up(input);
        case "cancel":
        case "lostcapture":
          return abort();
        case "dblclick":
          return doubleClick(input);
      }
    },
    cancel: abort,
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(ids) {
      set({ ids: sorted(ids) });
    },
    prune(doc = host.document()) {
      const kept = state.ids.filter((id) => doc.shapes.has(id));
      if (kept.length !== state.ids.length) set({ ids: kept });
    },
  };
}
