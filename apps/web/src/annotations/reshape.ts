import type { Point } from "../measure/ruler-maths.ts";
import { at, type Geometry, geometryRules, isClosedKind, type Shape } from "./shapes.ts";

export interface Handle {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface Edge {
  readonly from: number;
  readonly to: number;
  readonly a: Point;
  readonly b: Point;
}

const vertexKinds: ReadonlySet<string> = new Set(["polygon", "freehand", "ruler", "arrow"]);
const cornerKinds: ReadonlySet<string> = new Set(["rectangle", "ellipse"]);

export const maxEditableVertices = 2000;

function vertexAt(points: Float32Array, index: number): Point {
  return { x: at(points, index * 2), y: at(points, index * 2 + 1) };
}

function cornersOf(shape: Shape): Point[] {
  const x0 = Math.min(at(shape.points, 0), at(shape.points, 2));
  const x1 = Math.max(at(shape.points, 0), at(shape.points, 2));
  const y0 = Math.min(at(shape.points, 1), at(shape.points, 3));
  const y1 = Math.max(at(shape.points, 1), at(shape.points, 3));
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function geometryOf(points: Float32Array): Geometry {
  return { points, ringStarts: Uint32Array.of(0, points.length >> 1) };
}

function vertexCount(shape: Shape): number {
  return shape.points.length >> 1;
}

export function isReshapable(shape: Shape): boolean {
  if (vertexKinds.has(shape.kind)) return vertexCount(shape) <= maxEditableVertices;
  return cornerKinds.has(shape.kind);
}

export function handlesOf(shape: Shape): Handle[] {
  if (!isReshapable(shape)) return [];
  if (cornerKinds.has(shape.kind)) return cornersOf(shape).map((p, id) => ({ id, ...p }));
  return Array.from({ length: vertexCount(shape) }, (_, id) => ({
    id,
    ...vertexAt(shape.points, id),
  }));
}

export function edgesOf(shape: Shape): Edge[] {
  if (!isReshapable(shape) || !vertexKinds.has(shape.kind)) return [];
  const count = vertexCount(shape);
  const total = isClosedKind(shape.kind) ? count : count - 1;
  return Array.from({ length: total }, (_, from) => {
    const to = (from + 1) % count;
    return { from, to, a: vertexAt(shape.points, from), b: vertexAt(shape.points, to) };
  });
}

export function neighbourOf(shape: Shape, id: number): Point | null {
  if (!vertexKinds.has(shape.kind)) return null;
  const count = vertexCount(shape);
  if (count < 2) return null;
  if (id > 0) return vertexAt(shape.points, id - 1);
  return vertexAt(shape.points, isClosedKind(shape.kind) ? count - 1 : 1);
}

export function moveHandle(shape: Shape, id: number, to: Point): Geometry {
  if (cornerKinds.has(shape.kind)) {
    const opposite = cornersOf(shape)[(id + 2) % 4] ?? to;
    return geometryOf(Float32Array.of(opposite.x, opposite.y, to.x, to.y));
  }
  const points = shape.points.slice();
  points[id * 2] = to.x;
  points[id * 2 + 1] = to.y;
  return geometryOf(points);
}

export function moveEdge(shape: Shape, edge: Edge, dx: number, dy: number): Geometry {
  const points = shape.points.slice();
  for (const index of [edge.from, edge.to]) {
    points[index * 2] = at(shape.points, index * 2) + dx;
    points[index * 2 + 1] = at(shape.points, index * 2 + 1) + dy;
  }
  return geometryOf(points);
}

export function canInsertVertex(shape: Shape): boolean {
  return isClosedKind(shape.kind) && vertexKinds.has(shape.kind) && isReshapable(shape);
}

export function canRemoveVertex(shape: Shape): boolean {
  return canInsertVertex(shape) && vertexCount(shape) > 3;
}

export function insertVertex(shape: Shape, edge: Edge, point: Point): Geometry {
  const points = new Float32Array((vertexCount(shape) + 1) * 2);
  const after = edge.from + 1;
  points.set(shape.points.subarray(0, after * 2), 0);
  points[after * 2] = point.x;
  points[after * 2 + 1] = point.y;
  points.set(shape.points.subarray(after * 2), (after + 1) * 2);
  return geometryOf(points);
}

export function removeVertex(shape: Shape, id: number): Geometry {
  const points = new Float32Array(shape.points.length - 2);
  points.set(shape.points.subarray(0, id * 2), 0);
  points.set(shape.points.subarray((id + 1) * 2), id * 2);
  return geometryOf(points);
}

export interface Midpoint {
  readonly edge: Edge;
  readonly at: Point;
}

export function midpointsOf(shape: Shape): Midpoint[] {
  if (!canInsertVertex(shape)) return [];
  return edgesOf(shape).map((edge) => ({
    edge,
    at: { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 },
  }));
}

export function moveVertices(
  shape: Shape,
  ids: readonly number[],
  dx: number,
  dy: number,
): Geometry {
  const points = shape.points.slice();
  for (const id of new Set(ids)) {
    if (id < 0 || id >= vertexCount(shape)) continue;
    points[id * 2] = at(shape.points, id * 2) + dx;
    points[id * 2 + 1] = at(shape.points, id * 2 + 1) + dy;
  }
  return geometryOf(points);
}

export type RingPoint = readonly [number, number];
export type PointRing = readonly RingPoint[];

export const minRingPoints = 3;

export interface RingMidpoint {
  readonly from: number;
  readonly at: Point;
}

export function ringMidpoints(ring: PointRing): RingMidpoint[] {
  return ring.map(([ax, ay], from) => {
    const [bx, by] = ring[(from + 1) % ring.length] ?? [ax, ay];
    return { from, at: { x: (ax + bx) / 2, y: (ay + by) / 2 } };
  });
}

export function moveRingPoint(ring: PointRing, index: number, to: Point): PointRing {
  return ring.map((point, position) => (position === index ? ([to.x, to.y] as const) : point));
}

export function insertRingPoint(ring: PointRing, from: number, point: Point): PointRing {
  return [...ring.slice(0, from + 1), [point.x, point.y] as const, ...ring.slice(from + 1)];
}

export function removeRingPoints(ring: PointRing, ids: readonly number[]): PointRing | null {
  const doomed = new Set(ids.filter((id) => id >= 0 && id < ring.length));
  if (doomed.size === 0 || ring.length - doomed.size < minRingPoints) return null;
  return ring.filter((_, id) => !doomed.has(id));
}

const turn = (a: RingPoint, b: RingPoint, c: RingPoint) =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

const within = (a: RingPoint, b: RingPoint, c: RingPoint) =>
  Math.min(a[0], b[0]) <= c[0] &&
  c[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= c[1] &&
  c[1] <= Math.max(a[1], b[1]);

export function segmentsMeet(a: RingPoint, b: RingPoint, c: RingPoint, d: RingPoint): boolean {
  const abc = turn(a, b, c);
  const abd = turn(a, b, d);
  const cda = turn(c, d, a);
  const cdb = turn(c, d, b);
  if (abc * abd < 0 && cda * cdb < 0) return true;
  return (
    (abc === 0 && within(a, b, c)) ||
    (abd === 0 && within(a, b, d)) ||
    (cda === 0 && within(c, d, a)) ||
    (cdb === 0 && within(c, d, b))
  );
}

export function crossingEdges(ring: PointRing): number[] {
  const count = ring.length;
  const crossing = new Set<number>();
  if (count < 4) return [];
  for (let left = 0; left < count; left += 1) {
    const a = ring[left] ?? [0, 0];
    const b = ring[(left + 1) % count] ?? [0, 0];
    for (let right = left + 2; right < count; right += 1) {
      if (left === 0 && right === count - 1) continue;
      const c = ring[right] ?? [0, 0];
      const d = ring[(right + 1) % count] ?? [0, 0];
      if (segmentsMeet(a, b, c, d)) {
        crossing.add(left);
        crossing.add(right);
      }
    }
  }
  return [...crossing].sort((x, y) => x - y);
}

export function canRemoveVertices(shape: Shape, ids: readonly number[]): boolean {
  const doomed = new Set(ids.filter((id) => id >= 0 && id < vertexCount(shape)));
  if (doomed.size === 0 || !vertexKinds.has(shape.kind) || !isReshapable(shape)) return false;
  return vertexCount(shape) - doomed.size >= geometryRules[shape.kind].minVertices;
}

export function removeVertices(shape: Shape, ids: readonly number[]): Geometry | null {
  if (!canRemoveVertices(shape, ids)) return null;
  const doomed = new Set(ids);
  const kept: number[] = [];
  for (let id = 0; id < vertexCount(shape); id += 1) {
    if (!doomed.has(id)) kept.push(at(shape.points, id * 2), at(shape.points, id * 2 + 1));
  }
  return geometryOf(Float32Array.from(kept));
}
