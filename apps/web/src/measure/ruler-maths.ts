import { slideLengthToMicrons } from "@parfocal/viewer-engine";
import { type AnnotationDocument, isShapeHidden } from "../annotations/document.ts";
import {
  at,
  isClosedKind,
  outlineOf,
  ringCount,
  ringOf,
  type Shape,
} from "../annotations/shapes.ts";
import { formatMicrons, type LengthUnits } from "./length-units.ts";

export type Point = { readonly x: number; readonly y: number };

export type Segment = { readonly from: Point; readonly to: Point };

export const snapStepDegrees = 45;

export const minimumDragScreenPixels = 3;

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function snapToAngle(from: Point, to: Point, stepDegrees = snapStepDegrees): Point {
  const length = distance(from, to);
  if (length === 0) return to;
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

export function rulerMicrons(segment: Segment, micronsPerPixel: number | null): number | null {
  return slideLengthToMicrons(distance(segment.from, segment.to), micronsPerPixel);
}

export function formatRulerLength(
  segment: Segment,
  micronsPerPixel: number | null,
  units?: LengthUnits,
): string {
  const microns = rulerMicrons(segment, micronsPerPixel);
  if (microns === null) return `${Math.round(distance(segment.from, segment.to))} px`;
  return formatMicrons(microns, units);
}

export function segmentOfRuler(shape: Shape): Segment {
  return {
    from: { x: at(shape.points, 0), y: at(shape.points, 1) },
    to: { x: at(shape.points, 2), y: at(shape.points, 3) },
  };
}

export function rulerPoints(segment: Segment): Float32Array {
  return Float32Array.of(segment.from.x, segment.from.y, segment.to.x, segment.to.y);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const build = (input: readonly Point[]) => {
    const chain: Point[] = [];
    for (const point of input) {
      while (chain.length >= 2) {
        const last = chain[chain.length - 1];
        const before = chain[chain.length - 2];
        if (!last || !before || cross(before, last, point) > 0) break;
        chain.pop();
      }
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

export function longestAxis(points: readonly Point[]): Segment | null {
  const hull = convexHull(points);
  let best: Segment | null = null;
  let bestLength = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const from = hull[i];
      const to = hull[j];
      if (!from || !to) continue;
      const length = distance(from, to);
      if (length > bestLength) {
        bestLength = length;
        best = { from, to };
      }
    }
  }
  return best;
}

function ringsOf(shape: Shape): Float32Array[] {
  if (ringCount(shape) > 1) {
    return Array.from({ length: ringCount(shape) }, (_, index) => ringOf(shape, index));
  }
  return [outlineOf(shape)];
}

function toPoints(ring: Float32Array): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i += 2) out.push({ x: at(ring, i), y: at(ring, i + 1) });
  return out;
}

function insideRing(ring: Float32Array, point: Point): boolean {
  let inside = false;
  const count = ring.length >> 1;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = at(ring, i * 2);
    const yi = at(ring, i * 2 + 1);
    const xj = at(ring, j * 2);
    const yj = at(ring, j * 2 + 1);
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function containsPoint(shape: Shape, point: Point): boolean {
  if (!isClosedKind(shape.kind)) return false;
  const [minX, minY, maxX, maxY] = shape.bounds;
  if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) return false;
  return ringsOf(shape).reduce((inside, ring) => insideRing(ring, point) !== inside, false);
}

function boundsArea(shape: Shape): number {
  const [minX, minY, maxX, maxY] = shape.bounds;
  return (maxX - minX) * (maxY - minY);
}

export function areaUnder(doc: AnnotationDocument, point: Point): Shape | null {
  let best: Shape | null = null;
  for (const shape of doc.shapes.values()) {
    if (isShapeHidden(doc, shape) || !containsPoint(shape, point)) continue;
    if (best === null || boundsArea(shape) < boundsArea(best)) best = shape;
  }
  return best;
}

export function longestAxisOf(shape: Shape): Segment | null {
  return longestAxis(ringsOf(shape).flatMap(toPoints));
}

export function snapToAreaAxis(doc: AnnotationDocument, point: Point): Segment | null {
  const area = areaUnder(doc, point);
  return area === null ? null : longestAxisOf(area);
}
