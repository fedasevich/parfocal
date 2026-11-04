import { slideLengthToMicrons } from "@parfocal/viewer-engine";
import {
  at,
  isClosedKind,
  outlineOf,
  ringCount,
  ringOf,
  type Shape,
} from "../annotations/shapes.ts";

export type ShapeMeasure = {
  readonly areaSquarePixels: number;
  readonly perimeterPixels: number;
  readonly areaSquareMicrons: number | null;
  readonly perimeterMicrons: number | null;
};

function ringArea(ring: Float32Array): number {
  const count = ring.length >> 1;
  let sum = 0;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    sum += at(ring, j * 2) * at(ring, i * 2 + 1) - at(ring, i * 2) * at(ring, j * 2 + 1);
  }
  return Math.abs(sum) / 2;
}

function ringLength(ring: Float32Array): number {
  const count = ring.length >> 1;
  let sum = 0;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    sum += Math.hypot(at(ring, i * 2) - at(ring, j * 2), at(ring, i * 2 + 1) - at(ring, j * 2 + 1));
  }
  return sum;
}

function ringContainsVertex(ring: Float32Array, other: Float32Array): boolean {
  const x = at(other, 0);
  const y = at(other, 1);
  let inside = false;
  const count = ring.length >> 1;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = at(ring, i * 2);
    const yi = at(ring, i * 2 + 1);
    const xj = at(ring, j * 2);
    const yj = at(ring, j * 2 + 1);
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

function pixelMeasure(shape: Shape): { area: number; perimeter: number } {
  if (shape.kind === "ellipse") {
    const a = Math.abs(at(shape.points, 2) - at(shape.points, 0)) / 2;
    const b = Math.abs(at(shape.points, 3) - at(shape.points, 1)) / 2;
    return { area: Math.PI * a * b, perimeter: a + b === 0 ? 0 : ellipsePerimeter(a, b) };
  }
  if (ringCount(shape) <= 1) {
    const ring = outlineOf(shape);
    return { area: ringArea(ring), perimeter: ringLength(ring) };
  }
  const rings = Array.from({ length: ringCount(shape) }, (_, index) => ringOf(shape, index));
  let area = 0;
  let perimeter = 0;
  rings.forEach((ring, index) => {
    let depth = 0;
    rings.forEach((other, otherIndex) => {
      if (otherIndex !== index && ringContainsVertex(other, ring)) depth++;
    });
    area += depth % 2 === 0 ? ringArea(ring) : -ringArea(ring);
    perimeter += ringLength(ring);
  });
  return { area: Math.max(area, 0), perimeter };
}

export function measureShape(shape: Shape, micronsPerPixel: number | null): ShapeMeasure | null {
  if (!isClosedKind(shape.kind)) return null;
  const { area, perimeter } = pixelMeasure(shape);
  const side = slideLengthToMicrons(1, micronsPerPixel);
  return {
    areaSquarePixels: area,
    perimeterPixels: perimeter,
    areaSquareMicrons: side === null ? null : area * side * side,
    perimeterMicrons: side === null ? null : perimeter * side,
  };
}

export function formatArea(measure: ShapeMeasure): string {
  const microns = measure.areaSquareMicrons;
  if (microns === null) return `${Math.round(measure.areaSquarePixels)} px²`;
  if (microns < 100) return `${microns.toFixed(1)} µm²`;
  if (microns < 999_500) return `${Math.round(microns)} µm²`;
  return `${(microns / 1_000_000).toFixed(2)} mm²`;
}

export function formatPerimeter(measure: ShapeMeasure): string {
  const microns = measure.perimeterMicrons;
  if (microns === null) return `${Math.round(measure.perimeterPixels)} px`;
  const tenths = Math.round(microns * 10) / 10;
  if (tenths < 100) return `${tenths.toFixed(1)} µm`;
  if (microns < 999.5) return `${Math.round(microns)} µm`;
  return `${(microns / 1000).toFixed(2)} mm`;
}
