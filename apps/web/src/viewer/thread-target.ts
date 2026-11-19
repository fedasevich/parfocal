import type { Thread } from "@parfocal/api-client";
import type { SlideArea } from "@parfocal/viewer-engine";
import type { SlideAreaEntry } from "./slide-areas.ts";

const pointSpan = 400;

function collect(value: unknown, into: [number, number][]) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    into.push([value[0], value[1]]);
    return;
  }
  for (const item of value) collect(item, into);
}

function geometryArea(coordinates: unknown): SlideArea | null {
  const points: [number, number][] = [];
  collect(coordinates, points);
  const finite = points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (finite.length === 0) return null;
  const xs = finite.map(([x]) => x);
  const ys = finite.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  if (width === 0 && height === 0) {
    return {
      x: left - pointSpan / 2,
      y: top - pointSpan / 2,
      width: pointSpan,
      height: pointSpan,
    };
  }
  return { x: left, y: top, width, height };
}

export function threadTarget(
  anchor: Thread["anchor"],
  areas: readonly SlideAreaEntry[],
): SlideArea | null {
  const object = anchor.object_id;
  if (object !== undefined && object !== null) {
    const exact = areas.find((entry) => entry.object === object);
    if (exact) return exact.bounds;
    const parent = areas.find((entry) => entry.object === object.split("·")[0]);
    if (parent) return parent.bounds;
  }
  const geometry = anchor.geometry;
  return geometry ? geometryArea(geometry.coordinates) : null;
}

export function threadAnchorPoint(
  anchor: Thread["anchor"],
  areas: readonly SlideAreaEntry[],
): { x: number; y: number } | null {
  const target = threadTarget(anchor, areas);
  return target === null ? null : { x: target.x + target.width, y: target.y };
}
