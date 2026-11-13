import type {
  LineStringGeometry,
  MultiPolygonGeometry,
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

const signedArea = (ring: readonly Position[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
};

const contains = (ring: readonly Position[], p: Position): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const crosses = a[1] > p[1] !== b[1] > p[1];
    if (crosses && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
};

const closedRing = (ring: readonly Position[]): Position[] => {
  const first = ring[0];
  return first === undefined ? [] : [...ring, [first[0], first[1]]];
};

const ringPositions = (points: Float32Array): Position[] => {
  const ring: Position[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) ring.push([at(points, i), at(points, i + 1)]);
  return ring;
};

export function brushToGeoJson(
  points: Float32Array,
  ringStarts: Uint32Array,
): MultiPolygonGeometry {
  const outers: { ring: Position[]; area: number; holes: Position[][] }[] = [];
  const holes: Position[][] = [];
  for (let r = 0; r + 1 < ringStarts.length; r++) {
    const ring = ringPositions(points.subarray(at(ringStarts, r) * 2, at(ringStarts, r + 1) * 2));
    const area = signedArea(ring);
    if (area >= 0) outers.push({ ring, area, holes: [] });
    else holes.push(ring);
  }
  for (const hole of holes) {
    const probe = hole[0];
    if (probe === undefined) continue;
    const owner = outers
      .filter((outer) => contains(outer.ring, probe))
      .sort((a, b) => a.area - b.area)[0];
    owner?.holes.push(hole);
  }
  return {
    type: "MultiPolygon",
    coordinates: outers.map((outer) => [outer.ring, ...outer.holes].map(closedRing)),
  };
}

export function brushGeometryOf(
  annotation: WithGeometry,
): { points: Float32Array; ringStarts: Uint32Array } | null {
  const { geometry } = annotation;
  if (geometry["type"] !== "MultiPolygon") return null;
  const polygons = geometry["coordinates"];
  if (!Array.isArray(polygons)) return null;
  const rings: Position[][] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) return null;
    for (const [index, ring] of polygon.entries()) {
      if (!Array.isArray(ring) || !ring.every(isPosition)) return null;
      const last = ring.at(-1);
      const first = ring[0];
      const same =
        first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
      const open = same ? ring.slice(0, -1) : ring;
      if (open.length < 3) continue;
      const outer = index === 0;
      rings.push(signedArea(open) >= 0 === outer ? open : open.toReversed());
    }
  }
  if (rings.length === 0) return null;
  const ringStarts = new Uint32Array(rings.length + 1);
  const flat: number[] = [];
  rings.forEach((ring, r) => {
    for (const p of ring) flat.push(p[0], p[1]);
    ringStarts[r + 1] = (ringStarts[r] ?? 0) + ring.length;
  });
  return { points: Float32Array.from(flat), ringStarts };
}
