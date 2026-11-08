import type { AnnotationDraft } from "@parfocal/api-client";
import type { NewShape } from "./document.ts";
import {
  markerPointOf,
  pointToGeoJson,
  polygonPointsOf,
  polygonToGeoJson,
  savedArrowKind,
  savedMarkerKind,
  savedPolygonKind,
  savedRulerKind,
  savedTextKind,
  segmentPointsOf,
  segmentToGeoJson,
} from "./geojson.ts";
import { at, type Shape } from "./shapes.ts";

export type SavedRecord = {
  readonly kind: string;
  readonly geometry: Readonly<Record<string, unknown>>;
  readonly class_id?: string | null;
  readonly text?: string | null;
};

const spot = (shape: Shape) => pointToGeoJson({ x: at(shape.points, 0), y: at(shape.points, 1) });

export function draftOf(shape: Shape): AnnotationDraft | null {
  switch (shape.kind) {
    case "polygon":
      return { kind: savedPolygonKind, geometry: polygonToGeoJson(shape.points) };
    case "point":
      return { kind: savedMarkerKind, geometry: spot(shape), class_id: shape.classKey };
    case "ruler":
      return { kind: savedRulerKind, geometry: segmentToGeoJson(shape.points) };
    case "arrow":
      return { kind: savedArrowKind, geometry: segmentToGeoJson(shape.points) };
    case "text":
      return shape.text === null
        ? null
        : { kind: savedTextKind, geometry: spot(shape), text: shape.text };
    case "freehand":
    case "rectangle":
    case "ellipse":
    case "brush":
      return null;
  }
}

const pointOf = (record: SavedRecord) => {
  const point = markerPointOf(record);
  return point === null ? null : Float32Array.of(point.x, point.y);
};

export function shapeOf(record: SavedRecord): NewShape | null {
  switch (record.kind) {
    case savedPolygonKind: {
      const points = polygonPointsOf(record);
      return points === null ? null : { kind: "polygon", points };
    }
    case savedMarkerKind: {
      const points = pointOf(record);
      return points === null ? null : { kind: "point", points, classKey: record.class_id ?? null };
    }
    case savedRulerKind:
    case savedArrowKind: {
      const points = segmentPointsOf(record);
      if (points === null) return null;
      return { kind: record.kind === savedRulerKind ? "ruler" : "arrow", points };
    }
    case savedTextKind: {
      const points = pointOf(record);
      const text = record.text?.trim() ?? "";
      return points === null || text === "" ? null : { kind: "text", points, text };
    }
    default:
      return null;
  }
}

export function sameBody(before: Shape, after: Shape): boolean {
  if (before.classKey !== after.classKey || before.text !== after.text) return false;
  if (before.points.length !== after.points.length) return false;
  return before.points.every((value, index) => value === after.points[index]);
}
