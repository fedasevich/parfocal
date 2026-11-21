import type { Path64, Paths64 } from "clipper2-ts";
import type { Ring } from "./ai-edit.ts";
import { engine, fixedScale, strokeRegion } from "./brush.ts";
import type { Point } from "./polygon-draft.ts";
import { at, type Geometry, ringCount, ringOf } from "./shapes.ts";

export const cutWidthPx = 4;

const toPath = (ring: Ring): Path64 =>
  ring.map(([x, y]) => ({ x: Math.round(x * fixedScale), y: Math.round(y * fixedScale) }));

const toRing = (path: Path64): Ring =>
  path.map((point) => [point.x / fixedScale, point.y / fixedScale] as const);

function outerRings(paths: Paths64, rule: "evenOdd" | "nonZero" = "evenOdd"): Ring[] {
  const { area, FillRule, isPositive, union } = engine();
  return union(paths, rule === "evenOdd" ? FillRule.EvenOdd : FillRule.NonZero)
    .filter((path) => path.length >= 3 && isPositive(path))
    .sort((left, right) => Math.abs(area(right)) - Math.abs(area(left)))
    .map(toRing);
}

export function ringsOfGeometry(geometry: Geometry): Ring[] {
  const rings: Ring[] = [];
  for (let ring = 0; ring < ringCount(geometry); ring++) {
    const points = ringOf(geometry, ring);
    const pairs: [number, number][] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      pairs.push([at(points, index), at(points, index + 1)]);
    }
    rings.push(pairs);
  }
  return rings;
}

export function partsOf(rings: readonly Ring[]): Ring[] {
  return outerRings(rings.map(toPath));
}

export function splitRing(ring: Ring, line: readonly Point[], width: number): Ring[] | null {
  const { difference, FillRule } = engine();
  const cut = strokeRegion(line, width);
  if (cut.length === 0 || ring.length < 3) return null;
  const parts = outerRings(difference([toPath(ring)], cut, FillRule.NonZero));
  return parts.length >= 2 ? parts : null;
}

export function mergeRings(rings: readonly Ring[]): Ring | null {
  if (rings.length < 2) return null;
  const { FillRule, union } = engine();
  const upright = rings.flatMap((ring) => union([toPath(ring)], FillRule.NonZero));
  const merged = outerRings(upright, "nonZero");
  return merged.length === 1 ? (merged[0] ?? null) : null;
}

const numberOf = (object: string): [number, string] => {
  const found = /(\d+)([a-z]*)$/.exec(object);
  return [Number(found?.[1] ?? 0), found?.[2] ?? ""];
};

export function keeperOf(objects: readonly string[]): string | null {
  const sorted = [...objects].sort((left, right) => {
    const [a, x] = numberOf(left);
    const [b, y] = numberOf(right);
    return a - b || x.localeCompare(y);
  });
  return sorted[0] ?? null;
}
