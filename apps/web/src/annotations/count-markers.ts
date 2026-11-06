import { type AnnotationDocument, addShape, removeShape } from "./document.ts";
import { isSelectable } from "./hit-test.ts";
import type { Point } from "./polygon-draft.ts";
import { at, type Shape, type ShapeId } from "./shapes.ts";

export const unclassedKey = "";

export const markerHitScreenPixels = 9;

export type ClassCount = { readonly classKey: string; readonly count: number };

export function markersOf(doc: AnnotationDocument): Shape[] {
  return [...doc.shapes.values()].filter((shape) => shape.kind === "point");
}

export function markerPoint(shape: Shape): Point {
  return { x: at(shape.points, 0), y: at(shape.points, 1) };
}

export function dropMarker(
  doc: AnnotationDocument,
  point: Point,
  classKey: string | null,
): { document: AnnotationDocument; shape: Shape } {
  return addShape(doc, { kind: "point", points: Float32Array.of(point.x, point.y), classKey });
}

export function markerNear(doc: AnnotationDocument, point: Point, radius: number): ShapeId | null {
  let best: ShapeId | null = null;
  let bestDistance = radius;
  for (const shape of markersOf(doc)) {
    if (!isSelectable(doc, shape)) continue;
    const where = markerPoint(shape);
    const distance = Math.hypot(where.x - point.x, where.y - point.y);
    if (distance <= bestDistance) {
      best = shape.id;
      bestDistance = distance;
    }
  }
  return best;
}

export function deleteMarker(doc: AnnotationDocument, id: ShapeId): AnnotationDocument {
  const shape = doc.shapes.get(id);
  return shape?.kind === "point" ? removeShape(doc, id) : doc;
}

export function countByClass(doc: AnnotationDocument, classKeys: readonly string[]): ClassCount[] {
  const counts = new Map<string, number>(classKeys.map((key) => [key, 0]));
  for (const shape of markersOf(doc)) {
    const key = shape.classKey ?? unclassedKey;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([classKey, count]) => ({ classKey, count }));
}
