import { distance, longestAxis, type Point, type Segment } from "../../measure/ruler-maths.ts";
import { overviewFrame } from "../../viewer/still-frame.ts";
import { regionShapes } from "../review/slide-geometry.ts";
import type { Camera } from "../review/slide-still.tsx";
import { pathPoints } from "./minimap-placement.ts";
import type { Size } from "./tool-maths.ts";

export type AreaMeasurement = { across: string; mm: number };

export const fitMargin = 0.18;

export function areaOutline(object: string): Point[] {
  const shape = regionShapes[object];
  return shape ? pathPoints(shape.path).map(([x, y]) => ({ x, y })) : [];
}

type OutlinedArea = { object: string; outline?: readonly number[] | null | undefined };

export function regionOutline(
  area: OutlinedArea,
  slideSize: { width: number; height: number } | null,
): Point[] {
  if (!area.outline || slideSize === null) return areaOutline(area.object.replace("⁺", ""));
  const frame = overviewFrame(slideSize);
  const ring = area.outline;
  return Array.from({ length: Math.floor(ring.length / 2) }, (_, index) => ({
    x: ((ring[index * 2] ?? 0) - frame.offsetX) / frame.scale,
    y: ((ring[index * 2 + 1] ?? 0) - frame.offsetY) / frame.scale,
  }));
}

export const preDrawnLine = (outline: readonly Point[]): Segment | null => longestAxis(outline);

export function fitArea(outline: readonly Point[], view: Size, margin = fitMargin): Camera | null {
  if (outline.length === 0 || view.width <= 0 || view.height <= 0) return null;
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX) * (1 + 2 * margin);
  const height = Math.max(1, maxY - minY) * (1 + 2 * margin);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    scale: Math.min(view.width / width, view.height / height),
  };
}

export function lineMm(line: Segment, axis: Segment, aiSize: number): number {
  const axisLength = distance(axis.from, axis.to);
  if (axisLength === 0) return aiSize;
  return Number(((aiSize * distance(line.from, line.to)) / axisLength).toFixed(2));
}

export function largestMeasurement<T extends AreaMeasurement>(
  measurements: readonly T[],
): T | null {
  return measurements.reduce<T | null>(
    (best, item) => (best === null || item.mm > best.mm ? item : best),
    null,
  );
}
