import {
  difference,
  EndType,
  FillRule,
  inflatePaths,
  JoinType,
  type Path64,
  type Paths64,
  union,
} from "clipper2-ts";
import {
  type AnnotationDocument,
  addShape,
  isShapeLocked,
  removeShape,
  updateShape,
} from "./document.ts";
import type { Point } from "./polygon-draft.ts";
import { at, type Geometry, ringCount, ringOf, type Shape } from "./shapes.ts";

export const brushMinSize = 4;
export const brushMaxSize = 160;
export const brushDefaultSize = 24;
export const brushSizeStep = 1.25;

const fixedScale = 100;
const circleSegments = 48;

export type BrushMode = "paint" | "erase";

export type BrushStroke = {
  readonly points: readonly Point[];
  readonly diameter: number;
  readonly mode: BrushMode;
  readonly classKey: string | null;
};

export function clampBrushSize(size: number): number {
  if (!Number.isFinite(size)) return brushDefaultSize;
  return Math.min(brushMaxSize, Math.max(brushMinSize, Math.round(size)));
}

export function stepBrushSize(size: number, direction: 1 | -1): number {
  const stepped = direction > 0 ? size * brushSizeStep : size / brushSizeStep;
  const moved =
    direction > 0
      ? Math.max(Math.ceil(stepped), size + 1)
      : Math.min(Math.floor(stepped), size - 1);
  return clampBrushSize(moved);
}

export function brushModeOf(keys: {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): BrushMode {
  return keys.shiftKey || keys.altKey ? "erase" : "paint";
}

function toPath(points: readonly Point[]): Path64 {
  return points.map((p) => ({ x: Math.round(p.x * fixedScale), y: Math.round(p.y * fixedScale) }));
}

function circle(centre: Point, radius: number): Path64 {
  const path: Path64 = [];
  for (let i = 0; i < circleSegments; i++) {
    const angle = (2 * Math.PI * i) / circleSegments;
    path.push({
      x: Math.round((centre.x + Math.cos(angle) * radius) * fixedScale),
      y: Math.round((centre.y + Math.sin(angle) * radius) * fixedScale),
    });
  }
  return path;
}

function distinct(points: readonly Point[]): Point[] {
  const kept: Point[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last === undefined || last.x !== point.x || last.y !== point.y) kept.push(point);
  }
  return kept;
}

export function strokeRegion(points: readonly Point[], diameter: number): Paths64 {
  const radius = diameter / 2;
  const path = distinct(points);
  const first = path[0];
  if (first === undefined) return [];
  if (path.length === 1) return [circle(first, radius)];
  const swept = inflatePaths([toPath(path)], radius * fixedScale, JoinType.Round, EndType.Round);
  return union(swept, FillRule.NonZero);
}

function pathsOf(geometry: Geometry | null): Paths64 {
  if (geometry === null) return [];
  const paths: Paths64 = [];
  for (let ring = 0; ring < ringCount(geometry); ring++) {
    const points = ringOf(geometry, ring);
    const path: Path64 = [];
    for (let i = 0; i < points.length; i += 2) {
      path.push({
        x: Math.round(at(points, i) * fixedScale),
        y: Math.round(at(points, i + 1) * fixedScale),
      });
    }
    paths.push(path);
  }
  return paths;
}

function geometryOf(paths: Paths64): Geometry | null {
  const kept = paths.filter((path) => path.length >= 3);
  if (kept.length === 0) return null;
  const total = kept.reduce((sum, path) => sum + path.length, 0);
  const points = new Float32Array(total * 2);
  const ringStarts = new Uint32Array(kept.length + 1);
  let cursor = 0;
  kept.forEach((path, ring) => {
    for (const p of path) {
      points[cursor * 2] = p.x / fixedScale;
      points[cursor * 2 + 1] = p.y / fixedScale;
      cursor += 1;
    }
    ringStarts[ring + 1] = cursor;
  });
  return { points, ringStarts };
}

export function applyToRegion(
  region: Geometry | null,
  stroke: Pick<BrushStroke, "points" | "diameter" | "mode">,
): Geometry | null {
  const swept = strokeRegion(stroke.points, stroke.diameter);
  const current = pathsOf(region);
  if (stroke.mode === "erase") {
    if (current.length === 0) return null;
    return geometryOf(difference(current, swept, FillRule.NonZero));
  }
  return geometryOf(union([...current, ...swept], FillRule.NonZero));
}

export function mapOf(doc: AnnotationDocument, classKey: string | null): Shape | null {
  let found: Shape | null = null;
  for (const shape of doc.shapes.values()) {
    if (shape.kind !== "brush" || shape.classKey !== classKey) continue;
    if (found === null || shape.id < found.id) found = shape;
  }
  return found;
}

export function paintStroke(doc: AnnotationDocument, stroke: BrushStroke): AnnotationDocument {
  const map = mapOf(doc, stroke.classKey);
  if (map !== null && isShapeLocked(doc, map)) return doc;
  const next = applyToRegion(map, stroke);
  if (map === null) {
    if (next === null) return doc;
    return addShape(doc, {
      kind: "brush",
      points: next.points,
      ringStarts: next.ringStarts,
      classKey: stroke.classKey,
    }).document;
  }
  if (next === null) return removeShape(doc, map.id);
  return updateShape(doc, map.id, { geometry: next }).document;
}
