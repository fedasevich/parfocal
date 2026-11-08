import {
  type AnnotationDocument,
  getShape,
  isShapeHidden,
  linkThread,
  type PinPlacement,
  unlinkThread,
} from "./document.ts";
import { pickShape } from "./hit-test.ts";
import type { Point } from "./polygon-draft.ts";
import type { Shape } from "./shapes.ts";

export const pinHitScreenPixels = 6;

export function referencePoint(shape: Shape): Point {
  const [minX, minY, maxX, maxY] = shape.bounds;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export function placementAt(doc: AnnotationDocument, at: Point, tolerance: number): PinPlacement {
  const target = pickShape(doc, at, tolerance);
  if (target === null) return { shapeId: null, offset: at };
  const reference = referencePoint(target);
  return { shapeId: target.id, offset: { x: at.x - reference.x, y: at.y - reference.y } };
}

export function pinPoint(
  doc: AnnotationDocument,
  threadId: string,
  fallback: Point | null,
): Point | null {
  const placement = doc.pins.get(threadId);
  if (placement === undefined) return fallback;
  if (placement.shapeId === null) return placement.offset;
  const shape = getShape(doc, placement.shapeId);
  if (shape === undefined || isShapeHidden(doc, shape)) return null;
  const reference = referencePoint(shape);
  return { x: reference.x + placement.offset.x, y: reference.y + placement.offset.y };
}

function withPlacement(
  doc: AnnotationDocument,
  threadId: string,
  placement: PinPlacement,
): AnnotationDocument {
  const previous = doc.pins.get(threadId);
  let next = doc;
  if (
    previous?.shapeId != null &&
    previous.shapeId !== placement.shapeId &&
    getShape(next, previous.shapeId) !== undefined
  ) {
    next = unlinkThread(next, previous.shapeId, threadId).document;
  }
  if (placement.shapeId !== null) next = linkThread(next, placement.shapeId, threadId).document;
  const pins = new Map(next.pins);
  pins.set(threadId, placement);
  return { ...next, pins };
}

export function placePin(
  doc: AnnotationDocument,
  threadId: string,
  at: Point,
  tolerance: number,
): AnnotationDocument {
  return withPlacement(doc, threadId, placementAt(doc, at, tolerance));
}

export const movePin = placePin;

export const pinBodyScreenPixels = 28;

export function shiftPin(
  doc: AnnotationDocument,
  threadId: string,
  from: Point,
  dx: number,
  dy: number,
): AnnotationDocument {
  const placement = doc.pins.get(threadId);
  const next: PinPlacement =
    placement === undefined
      ? { shapeId: null, offset: { x: from.x + dx, y: from.y + dy } }
      : {
          shapeId: placement.shapeId,
          offset: { x: placement.offset.x + dx, y: placement.offset.y + dy },
        };
  const pins = new Map(doc.pins);
  pins.set(threadId, next);
  return { ...doc, pins };
}

export function shiftPins(
  doc: AnnotationDocument,
  threadIds: readonly string[],
  points: ReadonlyMap<string, Point>,
  dx: number,
  dy: number,
  carriedShapes: ReadonlySet<number>,
): AnnotationDocument {
  let next = doc;
  for (const threadId of threadIds) {
    const from = points.get(threadId);
    if (from === undefined) continue;
    const shapeId = doc.pins.get(threadId)?.shapeId;
    if (shapeId != null && carriedShapes.has(shapeId)) continue;
    next = shiftPin(next, threadId, from, dx, dy);
  }
  return next;
}

function bodyOf(point: Point, pixel: number): [number, number, number, number] {
  const size = pinBodyScreenPixels * pixel;
  return [point.x, point.y - size, point.x + size, point.y];
}

export function pinAt(points: ReadonlyMap<string, Point>, at: Point, pixel: number): string | null {
  const slack = 2 * pixel;
  let best: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [threadId, point] of points) {
    const [minX, minY, maxX, maxY] = bodyOf(point, pixel);
    if (at.x < minX - slack || at.x > maxX + slack || at.y < minY - slack || at.y > maxY + slack) {
      continue;
    }
    const distance = Math.hypot(at.x - (minX + maxX) / 2, at.y - (minY + maxY) / 2);
    if (distance <= nearest) {
      best = threadId;
      nearest = distance;
    }
  }
  return best;
}

export function pinsInExtent(
  points: ReadonlyMap<string, Point>,
  extent: readonly [number, number, number, number],
  pixel: number,
): string[] {
  const found: string[] = [];
  for (const [threadId, point] of points) {
    const [minX, minY, maxX, maxY] = bodyOf(point, pixel);
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    if (
      centre.x >= extent[0] &&
      centre.x <= extent[2] &&
      centre.y >= extent[1] &&
      centre.y <= extent[3]
    ) {
      found.push(threadId);
    }
  }
  return found;
}

export function dropPin(doc: AnnotationDocument, threadId: string): AnnotationDocument {
  if (!doc.pins.has(threadId)) return doc;
  const pins = new Map(doc.pins);
  pins.delete(threadId);
  return { ...doc, pins };
}

export function pointOfAnchor(anchor: {
  kind: string;
  geometry?: { type: string; coordinates?: unknown } | null | undefined;
}): Point | null {
  const geometry = anchor.geometry;
  if (anchor.kind !== "point" || !geometry || geometry.type !== "Point") return null;
  const coordinates: unknown = geometry.coordinates;
  if (!Array.isArray(coordinates)) return null;
  const x: unknown = coordinates[0];
  const y: unknown = coordinates[1];
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}
