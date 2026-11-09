import { type MicronsPerPixel, micronsToSlideLength } from "@parfocal/viewer-engine";
import type { Point } from "../measure/ruler-maths.ts";
import { distanceToPolyline, pointInRing } from "./hit-test.ts";
import {
  at,
  centreOf,
  isClosedKind,
  outlineOf,
  ringOf,
  type Shape,
  type ShapeId,
} from "./shapes.ts";

export interface ShapeGroup {
  readonly key: string;
  readonly members: readonly ShapeId[];
}

export const boundaryTolerancePixels = 1e-3;

export const humanProvenanceKey = "human";

export const unclassedKey = "none";

export function groupByClass(shapes: readonly Shape[]): ShapeGroup[] {
  return collect(shapes, (shape) => shape.classKey ?? unclassedKey);
}

export function provenanceKeyOf(shape: Shape): string {
  const { provenance } = shape;
  if (provenance.kind === "human") return humanProvenanceKey;
  return provenance.version === null
    ? `model:${provenance.model}`
    : `model:${provenance.model}@${provenance.version}`;
}

export function groupByProvenance(shapes: readonly Shape[]): ShapeGroup[] {
  return collect(shapes, provenanceKeyOf);
}

export function groupByCluster(
  shapes: readonly Shape[],
  radiusMicrons: number,
  micronsPerPixel: MicronsPerPixel,
): ShapeGroup[] | null {
  const radius = micronsToSlideLength(radiusMicrons, micronsPerPixel);
  if (radius === null || !Number.isFinite(radius) || radius < 0) return null;
  const centres = shapes.map((shape) => centreOf(shape.bounds));
  const parent = shapes.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while ((parent[root] ?? root) !== root) root = parent[root] ?? root;
    return root;
  };
  for (let i = 0; i < shapes.length; i++) {
    const a = centres[i];
    if (!a) continue;
    for (let j = i + 1; j < shapes.length; j++) {
      const b = centres[j];
      if (!b) continue;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) > radius) continue;
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent[Math.max(rootI, rootJ)] = Math.min(rootI, rootJ);
    }
  }
  const byRoot = new Map<number, ShapeId[]>();
  shapes.forEach((shape, index) => {
    const root = find(index);
    const list = byRoot.get(root) ?? [];
    list.push(shape.id);
    byRoot.set(root, list);
  });
  return [...byRoot.entries()]
    .sort(([left], [right]) => left - right)
    .map(([root, members]) => ({ key: `cluster:${shapes[root]?.id ?? root}`, members }));
}

function ringArea(ring: Float32Array): number {
  const count = ring.length >> 1;
  let sum = 0;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    sum += at(ring, j * 2) * at(ring, i * 2 + 1) - at(ring, i * 2) * at(ring, j * 2 + 1);
  }
  return Math.abs(sum) / 2;
}

function outerRingOf(shape: Shape): Float32Array {
  return shape.kind === "brush" ? ringOf(shape, 0) : outlineOf(shape);
}

function verticesOf(ring: Float32Array): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i += 2) out.push({ x: at(ring, i), y: at(ring, i + 1) });
  return out;
}

function crossProduct(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = crossProduct(a, b, c);
  const d2 = crossProduct(a, b, d);
  const d3 = crossProduct(c, d, a);
  const d4 = crossProduct(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function onOrInside(p: Point, ring: Float32Array): boolean {
  return pointInRing(p, ring) || distanceToPolyline(p, ring, true) <= boundaryTolerancePixels;
}

function ringContains(outer: Float32Array, inner: Float32Array, closedInner: boolean): boolean {
  const points = verticesOf(inner);
  if (points.length === 0 || !points.every((p) => onOrInside(p, outer))) return false;
  const outerPoints = verticesOf(outer);
  const innerEdges = closedInner ? points.length : points.length - 1;
  for (let i = 0; i < innerEdges; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    for (let j = 0; j < outerPoints.length; j++) {
      const c = outerPoints[j];
      const d = outerPoints[(j + 1) % outerPoints.length];
      if (c && d && segmentsCross(a, b, c, d)) return false;
    }
  }
  return true;
}

export function contains(container: Shape, inner: Shape): boolean {
  if (container.id === inner.id || !isClosedKind(container.kind)) return false;
  const outer = outerRingOf(container);
  if (outer.length < 6) return false;
  const [cx0, cy0, cx1, cy1] = container.bounds;
  const [ix0, iy0, ix1, iy1] = inner.bounds;
  const slack = boundaryTolerancePixels;
  if (ix0 < cx0 - slack || iy0 < cy0 - slack || ix1 > cx1 + slack || iy1 > cy1 + slack) {
    return false;
  }
  return ringContains(outer, outerRingOf(inner), isClosedKind(inner.kind));
}

export function groupByContainment(shapes: readonly Shape[]): ShapeGroup[] {
  const sizes = new Map(shapes.map((shape) => [shape.id, ringArea(outerRingOf(shape))]));
  const sizeOf = (shape: Shape) => sizes.get(shape.id) ?? 0;
  const outranks = (a: Shape, b: Shape) =>
    sizeOf(a) > sizeOf(b) || (sizeOf(a) === sizeOf(b) && a.id < b.id);
  const children = new Map<ShapeId, ShapeId[]>();
  for (const inner of shapes) {
    let parent: Shape | undefined;
    for (const candidate of shapes) {
      if (!outranks(candidate, inner) || !contains(candidate, inner)) continue;
      if (!parent || outranks(parent, candidate)) parent = candidate;
    }
    if (!parent) continue;
    const list = children.get(parent.id) ?? [];
    list.push(inner.id);
    children.set(parent.id, list);
  }
  return [...children.entries()]
    .sort(([left], [right]) => left - right)
    .map(([id, members]) => ({ key: `container:${id}`, members }));
}

export type GroupingRule =
  | { readonly by: "class" }
  | { readonly by: "provenance" }
  | { readonly by: "containment" }
  | { readonly by: "cluster"; readonly radiusMicrons: number };

export function groupShapes(
  shapes: readonly Shape[],
  rule: GroupingRule,
  micronsPerPixel: MicronsPerPixel,
): ShapeGroup[] | null {
  switch (rule.by) {
    case "class":
      return groupByClass(shapes);
    case "provenance":
      return groupByProvenance(shapes);
    case "containment":
      return groupByContainment(shapes);
    case "cluster":
      return groupByCluster(shapes, rule.radiusMicrons, micronsPerPixel);
  }
}

function collect(shapes: readonly Shape[], keyOf: (shape: Shape) => string): ShapeGroup[] {
  const groups = new Map<string, ShapeId[]>();
  for (const shape of shapes) {
    const key = keyOf(shape);
    const list = groups.get(key) ?? [];
    list.push(shape.id);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([key, members]) => ({ key, members }));
}
