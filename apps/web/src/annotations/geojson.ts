import type {
  LineStringGeometry,
  PointGeometry,
  PolygonGeometry,
  Position,
} from "@parfocal/api-client";
import type { Point } from "./polygon-draft.ts";
import { at } from "./shapes.ts";

type WithGeometry = { readonly geometry: Readonly<Record<string, unknown>> };

export const savedPolygonKind = "region";

export const savedMarkerKind = "cell";

export const savedRulerKind = "measurement";

export const savedArrowKind = "arrow";

export const savedTextKind = "text";

export function segmentToGeoJson(points: Float32Array): LineStringGeometry {
  return {
    type: "LineString",
    coordinates: [
      [at(points, 0), at(points, 1)],
      [at(points, 2), at(points, 3)],
    ],
  };
}

export function segmentPointsOf(annotation: WithGeometry): Float32Array | null {
  const { geometry } = annotation;
  if (geometry["type"] !== "LineString") return null;
  const ends: unknown = geometry["coordinates"];
  if (!Array.isArray(ends) || ends.length !== 2 || !ends.every(isPosition)) return null;
  return Float32Array.from(ends.flat());
}

export function pointToGeoJson(point: Point): PointGeometry {
  return { type: "Point", coordinates: [point.x, point.y] };
}

export function markerPointOf(annotation: WithGeometry): Point | null {
  const { geometry } = annotation;
  if (geometry["type"] !== "Point") return null;
  const position: unknown = geometry["coordinates"];
  return isPosition(position) ? { x: position[0], y: position[1] } : null;
}

export function polygonToGeoJson(points: Float32Array): PolygonGeometry {
  const ring: Position[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    ring.push([at(points, index), at(points, index + 1)]);
  }
  const first = ring[0];
  if (first !== undefined) ring.push([first[0], first[1]]);
  return { type: "Polygon", coordinates: [ring] };
}

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === "number" &&
  typeof value[1] === "number";

export function polygonPointsOf(annotation: WithGeometry): Float32Array | null {
  const { geometry } = annotation;
  if (geometry["type"] !== "Polygon") return null;
  const rings = geometry["coordinates"];
  if (!Array.isArray(rings) || rings.length !== 1) return null;
  const ring: unknown = rings[0];
  if (!Array.isArray(ring) || !ring.every(isPosition)) return null;
  const last = ring.at(-1);
  const first = ring[0];
  const closed = first !== undefined && last !== undefined && ring.length > 1;
  const open = closed && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  if (open.length < 3) return null;
  return Float32Array.from(open.flat());
}
