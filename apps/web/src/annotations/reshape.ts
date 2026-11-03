import type { Point } from "../measure/ruler-maths.ts";
import { at, type Geometry, isClosedKind, type Shape } from "./shapes.ts";

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
