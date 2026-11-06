export type ShapeId = number;
export type GroupId = number;
export type RunId = number;

export type Extent = readonly [minX: number, minY: number, maxX: number, maxY: number];

export const shapeKinds = [
  "polygon",
  "freehand",
  "rectangle",
  "ellipse",
  "point",
  "ruler",
  "arrow",
  "text",
  "brush",
] as const;

export type ShapeKind = (typeof shapeKinds)[number];

export const reviewStates = ["unreviewed", "agreed", "disagreed", "unsure"] as const;

export type ReviewState = (typeof reviewStates)[number];

export type Provenance =
  | { readonly kind: "human" }
  | {
      readonly kind: "model";
      readonly model: string;
      readonly version: string | null;
      readonly runId: RunId;
      readonly piece: number;
      readonly confidence: number | null;
      readonly edited: boolean;
      readonly typing?: OutlineTyping;
    };

export interface OutlineTyping {
  readonly typer: string;
  readonly version: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly type: string;
  readonly alternatives: readonly string[];
  readonly foreground: number;
  readonly mayNotBeNucleus: boolean;
}

export interface Geometry {
  readonly points: Float32Array;
  readonly ringStarts: Uint32Array;
}

export interface Shape extends Geometry {
  readonly id: ShapeId;
  readonly kind: ShapeKind;
  readonly classKey: string | null;
  readonly groupId: GroupId | null;
  readonly text: string | null;
  readonly provenance: Provenance;
  readonly reviewState: ReviewState;
  readonly threadIds: readonly string[];
  readonly bounds: Extent;
}

export interface GeometryRule {
  readonly rings: "one" | "many";
  readonly closed: boolean;
  readonly minVertices: number;
  readonly maxVertices: number;
}

const unbounded = Number.POSITIVE_INFINITY;

export const geometryRules: Readonly<Record<ShapeKind, GeometryRule>> = {
  polygon: { rings: "one", closed: true, minVertices: 3, maxVertices: unbounded },
  freehand: { rings: "one", closed: true, minVertices: 3, maxVertices: unbounded },
  rectangle: { rings: "one", closed: true, minVertices: 2, maxVertices: 2 },
  ellipse: { rings: "one", closed: true, minVertices: 2, maxVertices: 2 },
  point: { rings: "one", closed: false, minVertices: 1, maxVertices: 1 },
  ruler: { rings: "one", closed: false, minVertices: 2, maxVertices: 2 },
  arrow: { rings: "one", closed: false, minVertices: 2, maxVertices: 2 },
  text: { rings: "one", closed: false, minVertices: 1, maxVertices: 1 },
  brush: { rings: "many", closed: true, minVertices: 3, maxVertices: unbounded },
};

export const ellipseSegments = 64;

export class InvalidShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShapeError";
  }
}

export function isClosedKind(kind: ShapeKind): boolean {
  return geometryRules[kind].closed;
}

export function at(values: ArrayLike<number>, index: number): number {
  return values[index] ?? 0;
}

export function ringCount(geometry: Geometry): number {
  return geometry.ringStarts.length - 1;
}

export function ringOf(geometry: Geometry, index: number): Float32Array {
  return geometry.points.subarray(
    at(geometry.ringStarts, index) * 2,
    at(geometry.ringStarts, index + 1) * 2,
  );
}

export function singleRing(points: Float32Array): Geometry {
  return { points, ringStarts: Uint32Array.of(0, points.length >> 1) };
}

export function boundsOf(points: Float32Array): Extent {
  if (points.length === 0) return [0, 0, 0, 0];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < points.length; i += 2) {
    const x = at(points, i);
    const y = at(points, i + 1);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function centreOf(bounds: Extent): [number, number] {
  return [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
}

export function validateGeometry(kind: ShapeKind, geometry: Geometry): void {
  const rule = geometryRules[kind];
  const { points, ringStarts } = geometry;
  if (points.length % 2 !== 0) {
    throw new InvalidShapeError(`${kind} needs x and y for every vertex`);
  }
  for (const value of points) {
    if (!Number.isFinite(value)) {
      throw new InvalidShapeError(`${kind} has a coordinate that is not finite`);
    }
  }
  if (ringStarts.length < 2 || ringStarts[0] !== 0) {
    throw new InvalidShapeError(`${kind} needs ring starts that begin at zero`);
  }
  if (ringStarts[ringStarts.length - 1] !== points.length >> 1) {
    throw new InvalidShapeError(`${kind} ring starts must end at the vertex count`);
  }
  if (rule.rings === "one" && ringStarts.length !== 2) {
    throw new InvalidShapeError(`${kind} has exactly one ring`);
  }
  for (let ring = 0; ring < ringStarts.length - 1; ring++) {
    const size = at(ringStarts, ring + 1) - at(ringStarts, ring);
    if (size < rule.minVertices || size > rule.maxVertices) {
      throw new InvalidShapeError(`${kind} cannot have ${size} vertices in a ring`);
    }
  }
}

export function outlineOf(shape: Geometry & { readonly kind: ShapeKind }): Float32Array {
  const { points } = shape;
  if (shape.kind === "rectangle") {
    const x0 = at(points, 0);
    const y0 = at(points, 1);
    const x1 = at(points, 2);
    const y1 = at(points, 3);
    return Float32Array.of(x0, y0, x1, y0, x1, y1, x0, y1);
  }
  if (shape.kind === "ellipse") {
    const x0 = at(points, 0);
    const y0 = at(points, 1);
    const x1 = at(points, 2);
    const y1 = at(points, 3);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = Math.abs(x1 - x0) / 2;
    const ry = Math.abs(y1 - y0) / 2;
    const out = new Float32Array(ellipseSegments * 2);
    for (let i = 0; i < ellipseSegments; i++) {
      const angle = (2 * Math.PI * i) / ellipseSegments;
      out[i * 2] = cx + Math.cos(angle) * rx;
      out[i * 2 + 1] = cy + Math.sin(angle) * ry;
    }
    return out;
  }
  return points;
}

export function translateGeometry(geometry: Geometry, dx: number, dy: number): Geometry {
  const points = new Float32Array(geometry.points.length);
  for (let i = 0; i < points.length; i += 2) {
    points[i] = at(geometry.points, i) + dx;
    points[i + 1] = at(geometry.points, i + 1) + dy;
  }
  return { points, ringStarts: geometry.ringStarts };
}
