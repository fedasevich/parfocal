import type { AiObjectChange, ProjectClass } from "@parfocal/api-client";
import type { CheckedAiObject } from "./annotate-task.ts";
import type { Point } from "./polygon-draft.ts";
import type { Extent } from "./shapes.ts";

export type Ring = readonly (readonly [number, number])[];

export type AiState = {
  readonly object: string;
  readonly classId: string | null;
  readonly ring: Ring;
  readonly deleted: boolean;
};

export type AiCell = AiState & {
  readonly centre: Point;
  readonly bounds: Extent;
  readonly edited: boolean;
  readonly version: number | null;
  readonly score: number | null;
  readonly original: { readonly classId: string | null; readonly ring: Ring };
};

export type PickMode = "replace" | "add" | "toggle";

export type AiEditBridge = {
  marquee: (area: Extent, additive: boolean) => void;
  undo: () => boolean;
  redo: () => boolean;
  stamp: () => number;
};

export const idleAiBridge: AiEditBridge = {
  marquee: () => undefined,
  undo: () => false,
  redo: () => false,
  stamp: () => 0,
};

export const maxBatchCells = 5000;
export const maxHandles = 32;
export const aiHistoryLimit = 200;

const isPair = (value: unknown): value is [number, number] =>
  Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";

export function ringOf(geometry: unknown): Ring {
  if (typeof geometry !== "object" || geometry === null) return [];
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(coordinates)) return [];
  const rings: unknown[] = coordinates;
  const first: unknown = rings[0];
  const nested: unknown = Array.isArray(first) ? (first as unknown[])[0] : undefined;
  const outer = type === "MultiPolygon" ? nested : first;
  if (!Array.isArray(outer)) return [];
  const points = (outer as unknown[]).filter(isPair).map(([x, y]) => [x, y] as const);
  const start = points[0];
  const end = points[points.length - 1];
  const closed = start !== undefined && end !== undefined && points.length > 1;
  return closed && start[0] === end[0] && start[1] === end[1] ? points.slice(0, -1) : points;
}

export function geometryOf(ring: Ring) {
  const first = ring[0] ?? [0, 0];
  return {
    type: "Polygon" as const,
    coordinates: [[...ring, first].map(([x, y]): [number, number] => [x, y])],
  };
}

export function boundsOf(ring: Ring): Extent {
  let [left, top, right, bottom] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const [x, y] of ring) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return [left, top, right, bottom];
}

const copyIsEdit = (object: CheckedAiObject) =>
  object.copy !== undefined && (object.check === "edited" || object.check === "deleted");

export function cellOf(object: CheckedAiObject, pending?: AiState): AiCell {
  const original = { classId: object.class_id, ring: ringOf(object.geometry) };
  const copy = object.copy;
  const copied = copy !== undefined && object.check !== "unchecked";
  const copyRing = copied ? ringOf(copy.geometry) : [];
  const saved: AiState = {
    object: object.object,
    classId: (copied ? copy.class_id : null) ?? original.classId,
    ring: copyRing.length >= 3 ? copyRing : original.ring,
    deleted: object.check === "deleted",
  };
  const state = pending ?? saved;
  const bounds = boundsOf(state.ring);
  return {
    ...state,
    bounds,
    centre: { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 },
    edited: pending !== undefined || copyIsEdit(object),
    version: copy?.version ?? null,
    score: object.score,
    original,
  };
}

export function cellsOf(
  objects: readonly CheckedAiObject[],
  pending: ReadonlyMap<string, AiState>,
): AiCell[] {
  return objects.map((object) => cellOf(object, pending.get(object.object)));
}

export function inRing(ring: Ring, point: Point): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[index] ?? [0, 0];
    const [bx, by] = ring[previous] ?? [0, 0];
    if (ay > point.y !== by > point.y && point.x < ((bx - ax) * (point.y - ay)) / (by - ay) + ax)
      inside = !inside;
  }
  return inside;
}

const areaOf = (bounds: Extent) => (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);

export function hitCell(cells: readonly AiCell[], point: Point, tolerance: number): AiCell | null {
  let best: AiCell | null = null;
  for (const cell of cells) {
    if (cell.deleted) continue;
    const [left, top, right, bottom] = cell.bounds;
    if (
      point.x < left - tolerance ||
      point.x > right + tolerance ||
      point.y < top - tolerance ||
      point.y > bottom + tolerance
    )
      continue;
    const near = Math.max(right - left, bottom - top) <= tolerance * 2;
    if (!near && !inRing(cell.ring, point)) continue;
    if (best === null || areaOf(cell.bounds) < areaOf(best.bounds)) best = cell;
  }
  return best;
}

export function cellsInExtent(cells: readonly AiCell[], extent: Extent): string[] {
  const left = Math.min(extent[0], extent[2]);
  const right = Math.max(extent[0], extent[2]);
  const top = Math.min(extent[1], extent[3]);
  const bottom = Math.max(extent[1], extent[3]);
  return cells
    .filter(
      ({ centre, deleted }) =>
        !deleted && centre.x >= left && centre.x <= right && centre.y >= top && centre.y <= bottom,
    )
    .map((cell) => cell.object);
}

export function cellsInLasso(cells: readonly AiCell[], path: readonly Point[]): string[] {
  if (path.length < 3) return [];
  const ring: Ring = path.map((point) => [point.x, point.y] as const);
  const inside = new Set(cellsInExtent(cells, boundsOf(ring)));
  return cells
    .filter((cell) => inside.has(cell.object) && inRing(ring, cell.centre))
    .map((cell) => cell.object);
}

export function pick(
  current: readonly string[],
  picked: readonly string[],
  mode: PickMode,
): string[] {
  if (mode === "replace") return [...picked].slice(0, maxBatchCells);
  const now = new Set(current);
  for (const id of picked) {
    if (mode === "toggle" && now.has(id)) now.delete(id);
    else now.add(id);
  }
  return [...now].slice(0, maxBatchCells);
}

export type TypeChip = {
  readonly classId: string | null;
  readonly name: string;
  readonly count: number;
};

export function chipsOf(
  cells: readonly AiCell[],
  selection: readonly string[],
  classes: readonly ProjectClass[],
): TypeChip[] {
  const chosen = new Set(selection);
  const counts = new Map<string | null, number>();
  for (const cell of cells) {
    if (chosen.has(cell.object)) counts.set(cell.classId, (counts.get(cell.classId) ?? 0) + 1);
  }
  const known = classes
    .filter((item) => counts.has(item.id))
    .map((item) => ({ classId: item.id, name: item.name, count: counts.get(item.id) ?? 0 }));
  const named = new Set<string | null>(known.map((chip) => chip.classId));
  const untyped = [...counts]
    .filter(([classId]) => !named.has(classId))
    .reduce((sum, [, count]) => sum + count, 0);
  return untyped > 0 ? [...known, { classId: null, name: "No type", count: untyped }] : known;
}

export function narrow(
  cells: readonly AiCell[],
  selection: readonly string[],
  classId: string | null,
  keep: boolean,
  classes: readonly ProjectClass[],
): string[] {
  const known = new Set(classes.map((item) => item.id));
  const typeOf = (cell: AiCell) =>
    cell.classId !== null && known.has(cell.classId) ? cell.classId : null;
  const byId = new Map(cells.map((cell) => [cell.object, cell]));
  return selection.filter((id) => {
    const cell = byId.get(id);
    return cell !== undefined && (typeOf(cell) === classId) === keep;
  });
}

export function readingOrder(cells: readonly AiCell[]): string[] {
  const live = cells.filter((cell) => !cell.deleted);
  if (live.length === 0) return [];
  const heights = live.map((cell) => cell.bounds[3] - cell.bounds[1]).sort((a, b) => a - b);
  const band = Math.max(1, (heights[heights.length >> 1] ?? 1) * 1.5);
  return [...live]
    .sort(
      (left, right) =>
        Math.floor(left.centre.y / band) - Math.floor(right.centre.y / band) ||
        left.centre.x - right.centre.x ||
        left.centre.y - right.centre.y,
    )
    .map((cell) => cell.object);
}

export function stepFrom(
  order: readonly string[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index < 0) return order[delta === 1 ? 0 : order.length - 1] ?? null;
  return order[(index + delta + order.length) % order.length] ?? null;
}

const triangle = (
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

export function simplifyRing(ring: Ring, limit = maxHandles): Ring {
  const points = [...ring];
  while (points.length > Math.max(3, limit)) {
    let weakest = 0;
    let smallest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < points.length; index += 1) {
      const before = points[(index + points.length - 1) % points.length] ?? [0, 0];
      const here = points[index] ?? [0, 0];
      const after = points[(index + 1) % points.length] ?? [0, 0];
      const area = triangle(before, here, after);
      if (area < smallest) {
        smallest = area;
        weakest = index;
      }
    }
    points.splice(weakest, 1);
  }
  return points;
}

export const movedRing = (ring: Ring, dx: number, dy: number): Ring =>
  ring.map(([x, y]) => [x + dx, y + dy] as const);

export const withVertex = (ring: Ring, index: number, at: Point): Ring =>
  ring.map((point, position) => (position === index ? ([at.x, at.y] as const) : point));

export const stateOf = ({ object, classId, ring, deleted }: AiState): AiState => ({
  object,
  classId,
  ring,
  deleted,
});

export const originalOf = (cell: AiCell): AiState => ({
  object: cell.object,
  classId: cell.original.classId,
  ring: cell.original.ring,
  deleted: false,
});

const sameRing = (left: Ring, right: Ring) =>
  left.length === right.length &&
  left.every((point, index) => point[0] === right[index]?.[0] && point[1] === right[index]?.[1]);

export const sameState = (left: AiState, right: AiState) =>
  left.classId === right.classId &&
  left.deleted === right.deleted &&
  sameRing(left.ring, right.ring);

export function changeOf(state: AiState, version: number | null): AiObjectChange {
  return {
    object: state.object,
    geometry: geometryOf(state.ring),
    class_id: state.classId,
    deleted: state.deleted,
    ...(version === null ? {} : { version }),
  };
}

export type AiEntry = {
  readonly label: string;
  readonly before: readonly AiState[];
  readonly after: readonly AiState[];
};

export type AiHistory = { readonly entries: readonly AiEntry[]; readonly cursor: number };

export const emptyAiHistory: AiHistory = { entries: [], cursor: 0 };

export function recordAi(history: AiHistory, entry: AiEntry): AiHistory {
  const entries = [...history.entries.slice(0, history.cursor), entry];
  const kept = entries.slice(Math.max(0, entries.length - aiHistoryLimit));
  return { entries: kept, cursor: kept.length };
}

export function undoAi(history: AiHistory): { history: AiHistory; entry: AiEntry } | null {
  const entry = history.entries[history.cursor - 1];
  return entry === undefined
    ? null
    : { history: { ...history, cursor: history.cursor - 1 }, entry };
}

export function redoAi(history: AiHistory): { history: AiHistory; entry: AiEntry } | null {
  const entry = history.entries[history.cursor];
  return entry === undefined
    ? null
    : { history: { ...history, cursor: history.cursor + 1 }, entry };
}

export function retypedLine(count: number, className: string): string {
  return count === 1 ? `1 cell is now ${className}` : `${count} cells are now ${className}`;
}

export function tagOf(
  cell: AiCell,
  nameOf: (classId: string | null) => string,
  editor: string | null,
): string {
  const score = cell.score === null ? "" : ` ${cell.score.toFixed(2)}`;
  if (!cell.edited) return `${nameOf(cell.classId)}${score} · AI`;
  const by = editor === null ? "AI, edited" : `AI, edited by ${editor}`;
  const was =
    cell.classId === cell.original.classId ? "" : ` · was ${nameOf(cell.original.classId)}${score}`;
  return `${nameOf(cell.classId)} · ${by}${was}`;
}
