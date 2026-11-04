import { dropMarker } from "./count-markers.ts";
import { type AnnotationDocument, addShape, removeShape, updateShape } from "./document.ts";
import { markerPointOf, polygonPointsOf } from "./geojson.ts";
import type { Theirs } from "./save-queue.ts";
import { type ShapeId, singleRing } from "./shapes.ts";

type Raw = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function theirsFromCurrent(current: unknown): Theirs | null {
  if (!isRecord(current)) return null;
  const { version, geometry, class_id: classId, deleted_at: deletedAt } = current;
  if (typeof version !== "number" || !isRecord(geometry)) return null;
  const changedBy = current["changed_by_user_id"];
  return {
    version,
    deleted: typeof deletedAt === "string",
    geometry,
    classId: typeof classId === "string" ? classId : null,
    changedBy: typeof changedBy === "string" ? changedBy : null,
  };
}

export const vanished = (version: number): Theirs => ({
  version,
  deleted: true,
  geometry: {},
  classId: null,
  changedBy: null,
});

type Vertex = readonly [number, number];

export type Part =
  | { readonly kind: "polygon"; readonly points: readonly Vertex[] }
  | { readonly kind: "point"; readonly at: Vertex };

export function partOf(source: object): Part | null {
  const geometry = source as Raw;
  const points = polygonPointsOf({ geometry });
  if (points !== null) {
    const ring: Vertex[] = [];
    for (let index = 0; index + 1 < points.length; index += 2) {
      ring.push([points[index] ?? 0, points[index + 1] ?? 0]);
    }
    return { kind: "polygon", points: ring };
  }
  const marker = markerPointOf({ geometry });
  return marker === null ? null : { kind: "point", at: [marker.x, marker.y] };
}

export type Sketch = {
  readonly box: readonly [x: number, y: number, width: number, height: number];
  readonly mine: Part | null;
  readonly theirs: Part | null;
};

const verticesOf = (part: Part | null): readonly Vertex[] =>
  part === null ? [] : part.kind === "polygon" ? part.points : [part.at];

export function sketchOf(mine: object | null, theirs: object | null): Sketch {
  const first = mine === null ? null : partOf(mine);
  const second = theirs === null ? null : partOf(theirs);
  const all = [...verticesOf(first), ...verticesOf(second)];
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const minX = xs.length === 0 ? 0 : Math.min(...xs);
  const minY = ys.length === 0 ? 0 : Math.min(...ys);
  const span = Math.max(
    xs.length === 0 ? 0 : Math.max(...xs) - minX,
    ys.length === 0 ? 0 : Math.max(...ys) - minY,
    1,
  );
  const pad = span * 0.12;
  return {
    box: [minX - pad, minY - pad, span + pad * 2, span + pad * 2],
    mine: first,
    theirs: second,
  };
}

export type Adopted = { readonly document: AnnotationDocument; readonly shapeId: ShapeId | null };

export function adoptTheirs(doc: AnnotationDocument, id: ShapeId | null, theirs: Theirs): Adopted {
  const present = id !== null && doc.shapes.has(id);
  if (theirs.deleted) {
    return { document: present ? removeShape(doc, id) : doc, shapeId: null };
  }
  const part = partOf(theirs.geometry);
  if (part === null) return { document: doc, shapeId: present ? id : null };
  const points =
    part.kind === "polygon" ? Float32Array.from(part.points.flat()) : Float32Array.from(part.at);
  if (present) {
    const changed = updateShape(doc, id, {
      geometry: singleRing(points),
      ...(part.kind === "point" ? { classKey: theirs.classId } : {}),
    });
    return { document: changed.document, shapeId: id };
  }
  if (part.kind === "point") {
    const added = dropMarker(doc, { x: part.at[0], y: part.at[1] }, theirs.classId);
    return { document: added.document, shapeId: added.shape.id };
  }
  const added = addShape(doc, { kind: "polygon", points });
  return { document: added.document, shapeId: added.shape.id };
}
