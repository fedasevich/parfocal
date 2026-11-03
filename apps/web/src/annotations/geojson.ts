import type { Annotation, PolygonGeometry, Position } from "@parfocal/api-client";
import { at } from "./shapes.ts";

export const savedPolygonKind = "region";

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

export function polygonPointsOf(annotation: Annotation): Float32Array | null {
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
