import type { DoubleClickInput, InputPoint, PointerInput } from "@parfocal/viewer-engine";
import { minimumDragScreenPixels, type Point, snapToAngle } from "../measure/ruler-maths.ts";
import { deleteShapes } from "./clear.ts";
import { type AnnotationDocument, addShape, moveShape, updateShape } from "./document.ts";
import {
  extentOfCorners,
  isSelectable,
  pickShape,
  projectOnSegment,
  shapesInExtent,
} from "./hit-test.ts";
import { groupShapes, ungroupShapes } from "./layers.ts";
import { pinAt, pinsInExtent, shiftPins } from "./pins.ts";
import {
  canInsertVertex,
  canRemoveVertex,
  canRemoveVertices,
  type Edge,
  edgesOf,
  type Handle,
  handlesOf,
  insertVertex,
  isReshapable,
  midpointsOf,
  moveEdge,
  moveHandle,
  moveVertices,
  neighbourOf,
  removeVertex,
  removeVertices,
} from "./reshape.ts";
import type { Extent, Geometry, Shape, ShapeId } from "./shapes.ts";

export const hitTolerancePx = 6;
export const markHitTolerancePx = 12;
export const handleRadiusPx = 8;
export const handleHitRadiusPx = 12;
export const touchHandleHitRadiusPx = 22;
export const midpointHitRadiusPx = 10;
export const nudgeStepPx = 1;
export const fastNudgeStepPx = 10;

export type SelectGesture = "idle" | "press" | "move" | "marquee" | "vertex" | "edge";

export type Hover =
  | { readonly kind: "shape"; readonly id: ShapeId }
  | { readonly kind: "vertex"; readonly id: ShapeId; readonly vertex: number }
  | { readonly kind: "edge"; readonly id: ShapeId; readonly edge: Edge; readonly at: Point }
  | { readonly kind: "midpoint"; readonly id: ShapeId; readonly edge: Edge; readonly at: Point };

export interface SelectState {
  readonly ids: readonly ShapeId[];
  readonly pinIds: readonly string[];
  readonly gesture: SelectGesture;
  readonly marquee: Extent | null;
  readonly editing: ShapeId | null;
  readonly vertices: readonly number[];
  readonly hover: Hover | null;
}

export interface PinHost {
  readonly points: () => ReadonlyMap<string, Point>;
  readonly open: (threadId: string) => void;
  readonly remove: (threadIds: readonly string[], proceed: () => void) => void;
}

export interface SelectHost {
  readonly pins?: PinHost;
  readonly document: () => AnnotationDocument;
  readonly setDocument: (next: AnnotationDocument) => void;
  readonly toSlide: (at: InputPoint) => Point;
  readonly pixelSize: () => number;
  readonly commit?: (before: AnnotationDocument, after: AnnotationDocument, label: string) => void;
  readonly editText?: (id: ShapeId) => void;
}

export type SelectInput = PointerInput | DoubleClickInput;

export interface SelectTool {
  readonly handle: (input: SelectInput) => boolean;
  readonly cancel: () => boolean;
  readonly state: () => SelectState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly select: (ids: readonly ShapeId[], pinIds?: readonly string[]) => void;
  readonly prune: (doc?: AnnotationDocument) => void;
  readonly edit: (id: ShapeId | null) => boolean;
  readonly selectAll: () => void;
  readonly nudge: (dxPx: number, dyPx: number) => boolean;
  readonly removeSelected: () => boolean;
  readonly groupSelected: () => boolean;
  readonly ungroupSelected: () => boolean;
}

type Press = {
  readonly pointerId: number;
  readonly screen: Point;
  readonly slide: Point;
  readonly base: AnnotationDocument;
  readonly baseIds: readonly ShapeId[];
  readonly basePinIds: readonly string[];
  readonly pinPoints: ReadonlyMap<string, Point>;
  readonly baseVertices: readonly number[];
  readonly shift: boolean;
  readonly alt: boolean;
  work: AnnotationDocument;
  moved: boolean;
};

type Gesture =
  | (Press & { readonly kind: "shape"; readonly shapeId: ShapeId; readonly wasSelected: boolean })
  | (Press & { readonly kind: "pin"; readonly pinId: string; readonly wasSelected: boolean })
  | (Press & { readonly kind: "empty" })
  | (Press & {
      readonly kind: "vertex";
      readonly shapeId: ShapeId;
      readonly handle: Handle;
      readonly label: string;
    })
  | (Press & { readonly kind: "edge"; readonly shapeId: ShapeId; readonly edge: Edge });

const idle: SelectState = {
  ids: [],
  pinIds: [],
  gesture: "idle",
  marquee: null,
  editing: null,
  vertices: [],
  hover: null,
};

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function sorted(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function sameHover(a: Hover | null, b: Hover | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === "vertex" && b.kind === "vertex") return a.vertex === b.vertex;
  if (
    (a.kind === "edge" || a.kind === "midpoint") &&
    (b.kind === "edge" || b.kind === "midpoint")
  ) {
    return a.edge.from === b.edge.from && a.at.x === b.at.x && a.at.y === b.at.y;
  }
  return true;
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
      !sameList(next.ids, state.ids) ||
      !sameList(next.pinIds, state.pinIds) ||
      !sameList(next.vertices, state.vertices) ||
      next.gesture !== state.gesture ||
      next.marquee !== state.marquee ||
      next.editing !== state.editing ||
      !sameHover(next.hover, state.hover);
    if (!changed) return;
    state = {
      ...next,
      ids: sameList(next.ids, state.ids) ? state.ids : next.ids,
      pinIds: sameList(next.pinIds, state.pinIds) ? state.pinIds : next.pinIds,
      vertices: sameList(next.vertices, state.vertices) ? state.vertices : next.vertices,
    };
    for (const listener of listeners) listener();
  };

  const screenOf = (input: InputPoint): Point => ({ x: input.clientX, y: input.clientY });
  let coarse = false;
  const spacing = new WeakMap<Shape, number>();
  const spacingOf = (shape: Shape): number => {
    const known = spacing.get(shape);
    if (known !== undefined) return known;
    const handles = handlesOf(shape);
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < handles.length; i += 1) {
      for (let j = i + 1; j < handles.length; j += 1) {
        const a = handles[i];
        const b = handles[j];
        if (a && b) nearest = Math.min(nearest, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    spacing.set(shape, nearest);
    return nearest;
  };
  const reachOf = (shape: Shape, radiusPx: number) => {
    const wanted =
      (coarse ? Math.max(radiusPx, touchHandleHitRadiusPx) : radiusPx) * host.pixelSize();
    const floor = handleRadiusPx * host.pixelSize();
    return Math.min(wanted, Math.max(floor, spacingOf(shape) / 2));
  };
  const tolerance = () => hitTolerancePx * host.pixelSize();
  const markTolerance = () => markHitTolerancePx * host.pixelSize();

  const pick = (doc: AnnotationDocument, p: Point) =>
    pickShape(doc, p, tolerance(), markTolerance());

  const editShape = (): Shape | null =>
    state.editing === null ? null : (host.document().shapes.get(state.editing) ?? null);

  const soleShape = (): Shape | null => {
    const [only, ...rest] = state.ids;
    if (only === undefined || rest.length > 0) return null;
    return host.document().shapes.get(only) ?? null;
  };

  const handleShape = (): Shape | null => editShape() ?? soleShape();

  const handleAt = (shape: Shape, p: Point): Handle | null => {
    let best: Handle | null = null;
    let bestDistance = reachOf(shape, handleHitRadiusPx);
    for (const handle of handlesOf(shape)) {
      const distance = Math.hypot(handle.x - p.x, handle.y - p.y);
      if (distance <= bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best;
  };

  const midpointAt = (shape: Shape, p: Point) => {
    let best: { edge: Edge; at: Point } | null = null;
    let bestDistance = reachOf(shape, midpointHitRadiusPx);
    for (const midpoint of midpointsOf(shape)) {
      const distance = Math.hypot(midpoint.at.x - p.x, midpoint.at.y - p.y);
      if (distance <= bestDistance) {
        best = midpoint;
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

  const hoverAt = (p: Point): Hover | null => {
    const shape = handleShape();
    if (shape) {
      const handle = handleAt(shape, p);
      if (handle) return { kind: "vertex", id: shape.id, vertex: handle.id };
      if (state.editing !== null) {
        const midpoint = midpointAt(shape, p);
        if (midpoint) return { kind: "midpoint", id: shape.id, ...midpoint };
      }
      const edge = edgeAt(shape, p);
      if (edge) return { kind: "edge", id: shape.id, ...edge };
    }
    const hit = pick(host.document(), p);
    return hit ? { kind: "shape", id: hit.id } : null;
  };

  const commit = (before: AnnotationDocument, after: AnnotationDocument, label: string) => {
    if (after !== before) host.commit?.(before, after, label);
  };

  const apply = (before: AnnotationDocument, after: AnnotationDocument, label: string) => {
    host.setDocument(after);
    commit(before, after, label);
  };

  const startPress = (input: PointerInput): Press => {
    const base = host.document();
    return {
      pointerId: input.pointerId,
      screen: screenOf(input),
      slide: host.toSlide(input),
      base,
      work: base,
      baseIds: state.ids,
      basePinIds: state.pinIds,
      pinPoints: host.pins?.points() ?? new Map(),
      baseVertices: state.vertices,
      shift: input.shiftKey,
      alt: input.altKey,
      moved: false,
    };
  };

  const pressHandle = (press: Press, shape: Shape, handle: Handle): boolean => {
    if (state.editing !== null && press.alt) {
      if (canRemoveVertices(shape, [handle.id])) {
        const geometry = removeVertices(shape, [handle.id]);
        if (geometry) {
          apply(
            press.base,
            updateShape(press.base, shape.id, { geometry }).document,
            "Remove point",
          );
          set({ vertices: [] });
        }
      }
      return true;
    }
    let vertices = state.vertices;
    if (state.editing !== null) {
      if (press.shift) {
        vertices = vertices.includes(handle.id)
          ? vertices.filter((id) => id !== handle.id)
          : sorted([...vertices, handle.id]);
      } else if (!vertices.includes(handle.id)) {
        vertices = [handle.id];
      }
    }
    gesture = { ...press, kind: "vertex", shapeId: shape.id, handle, label: "Reshape" };
    set({ gesture: "press", vertices });
    return true;
  };

  const pressMidpoint = (press: Press, shape: Shape, midpoint: { edge: Edge; at: Point }) => {
    const geometry = insertVertex(shape, midpoint.edge, midpoint.at);
    const work = updateShape(press.base, shape.id, { geometry }).document;
    const inserted = work.shapes.get(shape.id);
    const handle = inserted
      ? (handlesOf(inserted).find((candidate) => candidate.id === midpoint.edge.from + 1) ?? null)
      : null;
    if (!inserted || !handle) return false;
    host.setDocument(work);
    gesture = {
      ...press,
      work,
      kind: "vertex",
      shapeId: shape.id,
      handle,
      label: "Add point",
      moved: true,
    };
    set({ gesture: "vertex", vertices: [handle.id] });
    return true;
  };

  const down = (input: PointerInput): boolean => {
    if (input.button !== 0) return false;
    if (gesture !== null) return true;
    const press = startPress(input);
    const shape = handleShape();
    if (shape) {
      const handle = handleAt(shape, press.slide);
      if (handle) return pressHandle(press, shape, handle);
      if (state.editing !== null && canInsertVertex(shape)) {
        const midpoint = midpointAt(shape, press.slide);
        if (midpoint && pressMidpoint(press, shape, midpoint)) return true;
      }
      const edge = edgeAt(shape, press.slide);
      if (edge) {
        gesture = { ...press, kind: "edge", shapeId: shape.id, edge: edge.edge };
        set({ gesture: "press", vertices: [edge.edge.from, edge.edge.to].sort((a, b) => a - b) });
        return true;
      }
    }
    const pinHit = host.pins ? pinAt(press.pinPoints, press.slide, host.pixelSize()) : null;
    if (pinHit !== null) {
      const wasSelected = state.pinIds.includes(pinHit);
      gesture = { ...press, kind: "pin", pinId: pinHit, wasSelected };
      set({
        gesture: "press",
        editing: null,
        vertices: [],
        ids: wasSelected || press.shift ? state.ids : [],
        pinIds: wasSelected || press.shift ? state.pinIds : [pinHit],
      });
      return true;
    }
    const hit = pick(press.base, press.slide);
    if (hit) {
      const leaving = state.editing !== null && hit.id !== state.editing;
      const wasSelected = !leaving && state.ids.includes(hit.id);
      gesture = { ...press, kind: "shape", shapeId: hit.id, wasSelected };
      set({
        gesture: "press",
        editing: leaving ? null : state.editing,
        vertices: leaving ? [] : state.vertices,
        ids: wasSelected || (press.shift && !leaving) ? state.ids : [hit.id],
        pinIds: wasSelected || press.shift ? state.pinIds : [],
      });
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

  const duplicateSelection = (current: Extract<Gesture, { kind: "shape" }>) => {
    let next = current.base;
    const copies: ShapeId[] = [];
    for (const id of state.ids) {
      const original = current.base.shapes.get(id);
      if (!original) continue;
      const added = addShape(next, {
        kind: original.kind,
        points: original.points.slice(),
        ringStarts: original.ringStarts.slice(),
        classKey: original.classKey,
        groupId: original.groupId,
        text: original.text,
      });
      next = added.document;
      copies.push(added.shape.id);
    }
    current.work = next;
    set({ ids: copies });
  };

  const applyMove = (
    current: Extract<Gesture, { kind: "shape" | "pin" }>,
    at: Point,
    shift: boolean,
  ) => {
    const delta = slideDelta(current, at, shift);
    let next = current.work;
    const carried = new Set<ShapeId>();
    for (const id of state.ids) {
      if (current.work.shapes.has(id)) {
        next = moveShape(next, id, delta.x, delta.y).document;
        carried.add(id);
      }
    }
    next = shiftPins(next, state.pinIds, current.pinPoints, delta.x, delta.y, carried);
    host.setDocument(next);
  };

  const applyVertex = (
    current: Extract<Gesture, { kind: "vertex" }>,
    at: Point,
    shift: boolean,
  ) => {
    const shape = current.work.shapes.get(current.shapeId);
    if (!shape) return;
    const carried = {
      x: current.handle.x + at.x - current.slide.x,
      y: current.handle.y + at.y - current.slide.y,
    };
    const anchor = shift ? neighbourOf(shape, current.handle.id) : null;
    const target = anchor ? snapToAngle(anchor, carried) : carried;
    const together = state.editing !== null && state.vertices.length > 1;
    const geometry = together
      ? moveVertices(
          shape,
          state.vertices,
          target.x - current.handle.x,
          target.y - current.handle.y,
        )
      : moveHandle(shape, current.handle.id, target);
    host.setDocument(updateShape(current.work, shape.id, { geometry }).document);
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
    const shape = editShape();
    if (shape) {
      const inside = handlesOf(shape)
        .filter((handle) => handle.x >= area[0] && handle.x <= area[2])
        .filter((handle) => handle.y >= area[1] && handle.y <= area[3])
        .map((handle) => handle.id);
      set({
        gesture: "marquee",
        marquee: area,
        vertices: sorted(current.shift ? [...current.baseVertices, ...inside] : inside),
      });
      return;
    }
    const inside = shapesInExtent(current.base, area).map((candidate) => candidate.id);
    const pinsInside = host.pins ? pinsInExtent(current.pinPoints, area, host.pixelSize()) : [];
    set({
      gesture: "marquee",
      marquee: area,
      ids: sorted(current.shift ? [...current.baseIds, ...inside] : inside),
      pinIds: current.shift
        ? [...new Set([...current.basePinIds, ...pinsInside])].sort()
        : pinsInside.sort(),
    });
  };

  const move = (input: PointerInput): boolean => {
    const current = gesture;
    if (current === null || input.pointerId !== current.pointerId) {
      if (current === null) set({ hover: hoverAt(host.toSlide(input)) });
      return false;
    }
    const travelled = Math.hypot(
      input.clientX - current.screen.x,
      input.clientY - current.screen.y,
    );
    if (!current.moved && travelled < minimumDragScreenPixels) return true;
    const at = host.toSlide(input);
    if (!current.moved) {
      current.moved = true;
      if (current.kind === "shape") {
        if (!state.ids.includes(current.shapeId)) set({ ids: [current.shapeId] });
        if (current.alt) duplicateSelection(current);
      }
      if (current.kind === "pin" && !state.pinIds.includes(current.pinId)) {
        set({ pinIds: [current.pinId] });
      }
    }
    switch (current.kind) {
      case "shape":
      case "pin":
        set({ gesture: "move", hover: null });
        applyMove(current, at, input.shiftKey);
        break;
      case "vertex":
        set({ gesture: "vertex", hover: null });
        applyVertex(current, at, input.shiftKey);
        break;
      case "edge":
        set({ gesture: "edge", hover: null });
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
    if (current.kind === "pin") {
      if (current.shift) {
        const pinIds = current.wasSelected
          ? state.pinIds.filter((id) => id !== current.pinId)
          : [...state.pinIds, current.pinId];
        set({ pinIds: pinIds.sort() });
      } else {
        set({ ids: [], pinIds: [current.pinId] });
        host.pins?.open(current.pinId);
      }
    }
    if (current.kind === "empty") {
      if (state.editing !== null) set({ vertices: [] });
      else if (!current.shift) set({ ids: [], pinIds: [] });
    }
  };

  const labelOf = (current: Gesture): string => {
    if (current.kind === "vertex") return current.label;
    if (current.kind === "edge") return "Reshape";
    if (current.kind === "pin") return "Move comment pin";
    if (current.kind === "shape") return current.alt ? "Duplicate" : "Move";
    return "Select";
  };

  const up = (input: PointerInput): boolean => {
    const current = gesture;
    if (current === null || input.pointerId !== current.pointerId) return false;
    gesture = null;
    if (!current.moved) finishClick(current);
    set({ gesture: "idle", marquee: null });
    if (current.moved && current.kind !== "empty") {
      const after = host.document();
      commit(current.base, after, labelOf(current));
    }
    return true;
  };

  const abort = (): boolean => {
    const current = gesture;
    if (current === null) return false;
    gesture = null;
    if (host.document() !== current.base) host.setDocument(current.base);
    set({
      gesture: "idle",
      marquee: null,
      ids: current.baseIds,
      pinIds: current.basePinIds,
      vertices:
        current.kind === "vertex" && current.label === "Add point" ? [] : current.baseVertices,
    });
    return true;
  };

  const edit = (id: ShapeId | null): boolean => {
    if (id === null) {
      if (state.editing === null) return false;
      set({ editing: null, vertices: [] });
      return true;
    }
    const shape = host.document().shapes.get(id);
    if (!shape || !isReshapable(shape) || !isSelectable(host.document(), shape)) return false;
    set({ ids: [id], editing: id, vertices: [] });
    return true;
  };

  const doubleClick = (input: DoubleClickInput): boolean => {
    if (input.button !== 0) return false;
    const at = host.toSlide(input);
    const shape = handleShape();
    if (shape) {
      const handle = handleAt(shape, at);
      if (handle) {
        if (canRemoveVertex(shape)) {
          apply(
            host.document(),
            updateShape(host.document(), shape.id, { geometry: removeVertex(shape, handle.id) })
              .document,
            "Remove point",
          );
          set({ vertices: [] });
        }
        return true;
      }
      const edge = edgeAt(shape, at);
      if (edge) {
        if (canInsertVertex(shape)) {
          applyGeometry(shape, insertVertex(shape, edge.edge, edge.at), "Add point");
          set({ vertices: [edge.edge.from + 1] });
        }
        return true;
      }
    }
    const hit = pick(host.document(), at);
    if (hit === null) {
      if (state.editing === null) return false;
      edit(null);
      return true;
    }
    if (hit.kind === "text") {
      set({ ids: [hit.id], editing: null, vertices: [] });
      host.editText?.(hit.id);
      return true;
    }
    if (!edit(hit.id)) set({ ids: [hit.id] });
    return true;
  };

  const applyGeometry = (shape: Shape, geometry: Geometry, label: string) => {
    const before = host.document();
    apply(before, updateShape(before, shape.id, { geometry }).document, label);
  };

  const nudge = (dxPx: number, dyPx: number): boolean => {
    const before = host.document();
    const dx = dxPx * host.pixelSize();
    const dy = dyPx * host.pixelSize();
    const shape = editShape();
    if (shape) {
      if (state.vertices.length === 0) return false;
      applyGeometry(shape, moveVertices(shape, state.vertices, dx, dy), "Nudge");
      return true;
    }
    if (state.ids.length === 0 && state.pinIds.length === 0) return false;
    let next = before;
    const carried = new Set<ShapeId>();
    for (const id of state.ids) {
      if (next.shapes.has(id)) {
        next = moveShape(next, id, dx, dy).document;
        carried.add(id);
      }
    }
    if (host.pins) {
      next = shiftPins(next, state.pinIds, host.pins.points(), dx, dy, carried);
    }
    apply(before, next, "Nudge");
    return true;
  };

  const removeSelected = (): boolean => {
    const before = host.document();
    const shape = editShape();
    if (shape) {
      const geometry = removeVertices(shape, state.vertices);
      if (geometry === null) return false;
      applyGeometry(shape, geometry, "Remove points");
      set({ vertices: [] });
      return true;
    }
    if (state.ids.length === 0 && state.pinIds.length === 0) return false;
    const removeShapes = () => {
      const current = host.document();
      apply(current, deleteShapes(current, state.ids).document, "Delete");
      set({ ids: [], pinIds: [], hover: null });
    };
    if (state.pinIds.length > 0 && host.pins) {
      host.pins.remove(state.pinIds, removeShapes);
      return true;
    }
    removeShapes();
    return true;
  };

  const groupSelected = () => {
    if (state.ids.length === 0 || state.gesture !== "idle") return false;
    const before = host.document();
    const made = groupShapes(before, state.ids);
    if (made === null) return false;
    apply(before, made.document, "Group");
    return true;
  };

  const ungroupSelected = () => {
    if (state.ids.length === 0 || state.gesture !== "idle") return false;
    const before = host.document();
    const after = ungroupShapes(before, state.ids);
    if (after === before) return false;
    apply(before, after, "Ungroup");
    return true;
  };

  const selectAll = () => {
    const doc = host.document();
    const shape = editShape();
    if (shape) {
      set({ vertices: handlesOf(shape).map((handle) => handle.id) });
      return;
    }
    set({
      ids: sorted(
        [...doc.shapes.values()]
          .filter((candidate) => isSelectable(doc, candidate))
          .map((s) => s.id),
      ),
      pinIds: host.pins ? [...host.pins.points().keys()].sort() : [],
    });
  };

  return {
    handle(input) {
      if (input.kind !== "dblclick") coarse = input.pointerType === "touch";
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
    select(ids, pinIds = []) {
      const next = sorted(ids);
      const keepEditing = state.editing !== null && sameList(next, [state.editing]);
      set({
        ids: next,
        pinIds: [...pinIds].sort(),
        editing: keepEditing ? state.editing : null,
        vertices: keepEditing ? state.vertices : [],
      });
    },
    prune(doc = host.document()) {
      const kept = state.ids.filter((id) => doc.shapes.has(id));
      const editing =
        state.editing !== null && doc.shapes.has(state.editing) ? state.editing : null;
      const shape = editing === null ? null : doc.shapes.get(editing);
      const count = shape ? handlesOf(shape).length : 0;
      const vertices = state.vertices.filter((id) => id < count);
      const livePins = host.pins?.points();
      const keptPins = livePins ? state.pinIds.filter((id) => livePins.has(id)) : state.pinIds;
      if (livePins && keptPins.length !== state.pinIds.length) set({ pinIds: keptPins });
      if (
        kept.length !== state.ids.length ||
        editing !== state.editing ||
        vertices.length !== state.vertices.length
      ) {
        set({ ids: kept, editing, vertices });
      }
    },
    edit,
    selectAll,
    nudge,
    removeSelected,
    groupSelected,
    ungroupSelected,
  };
}
