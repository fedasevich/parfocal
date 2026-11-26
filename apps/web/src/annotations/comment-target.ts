import type { ThreadCreate } from "@parfocal/api-client";
import { asciiObjectId } from "@parfocal/ui/lib/object-id";
import { pinTitle } from "../screens/review/comment-pin.ts";
import { type Mentionable, toMentionTokens } from "../screens/review/mention-picking.ts";
import type { AnnotationDocument } from "./document.ts";
import { drawnObjectIds, type SavedCodes } from "./drawn-object-ids.ts";
import { unionBounds } from "./layers-tree.ts";
import type { Point } from "./polygon-draft.ts";
import type { Extent, ShapeId } from "./shapes.ts";

export type CommentTarget =
  | { readonly kind: "point"; readonly at: Point }
  | {
      readonly kind: "object";
      readonly objectId: string;
      readonly shapes: readonly ShapeId[];
      readonly extent?: Extent | undefined;
      readonly resultSet?: string | undefined;
    }
  | { readonly kind: "shape"; readonly extent: Extent; readonly shapes: readonly ShapeId[] }
  | {
      readonly kind: "selection";
      readonly extents: readonly Extent[];
      readonly shapes: readonly ShapeId[];
    }
  | { readonly kind: "region"; readonly extent: Extent }
  | { readonly kind: "layer"; readonly layer: string; readonly name: string };

export type CommentDraft = {
  readonly target: CommentTarget;
  readonly at: Point;
  readonly clicked?: Point | undefined;
};

const leastSide = 1;

const ring = ([minX, minY, maxX, maxY]: Extent): [number, number][] => {
  const right = Math.max(maxX, minX + leastSide);
  const bottom = Math.max(maxY, minY + leastSide);
  return [
    [minX, minY],
    [right, minY],
    [right, bottom],
    [minX, bottom],
    [minX, minY],
  ];
};

export function targetOfShapes(
  doc: AnnotationDocument,
  codes: SavedCodes | undefined,
  ids: readonly ShapeId[],
): CommentTarget | null {
  const shapes = ids.filter((id) => doc.shapes.has(id));
  const first = shapes[0];
  if (first === undefined) return null;
  if (shapes.length > 1) {
    const extents = shapes.flatMap((id) => {
      const bounds = doc.shapes.get(id)?.bounds;
      return bounds === undefined ? [] : [bounds];
    });
    return { kind: "selection", extents, shapes };
  }
  const code = codes?.get(first);
  if (code !== undefined && /\d/.test(code)) {
    return {
      kind: "object",
      objectId: drawnObjectIds(doc, codes).get(first)?.shown ?? code,
      shapes,
    };
  }
  const bounds = doc.shapes.get(first)?.bounds;
  return bounds === undefined ? null : { kind: "shape", extent: bounds, shapes };
}

export function regionTarget(from: Point, to: Point): Extract<CommentTarget, { kind: "region" }> {
  return {
    kind: "region",
    extent: [
      Math.min(from.x, to.x),
      Math.min(from.y, to.y),
      Math.max(from.x, to.x),
      Math.max(from.y, to.y),
    ],
  };
}

export function targetExtent(doc: AnnotationDocument, target: CommentTarget): Extent | null {
  switch (target.kind) {
    case "point":
      return [target.at.x, target.at.y, target.at.x, target.at.y];
    case "region":
    case "shape":
      return target.extent;
    case "object":
      return target.shapes.length === 0 ? (target.extent ?? null) : unionBounds(doc, target.shapes);
    case "selection":
      return unionBounds(doc, target.shapes);
    case "layer":
      return null;
  }
}

export const areaOfExtent = (extent: Extent | null) =>
  extent === null
    ? null
    : { x: extent[0], y: extent[1], width: extent[2] - extent[0], height: extent[3] - extent[1] };

export function targetLabel(target: CommentTarget): string {
  switch (target.kind) {
    case "point":
      return "this point";
    case "object":
      return target.objectId;
    case "shape":
      return "this shape";
    case "selection":
      return `${target.shapes.length} objects`;
    case "region":
      return "this region";
    case "layer":
      return target.name;
  }
}

export const objectAnchor = (objectId: string, resultSet?: string): ThreadCreate["anchor"] => ({
  kind: objectId.startsWith("R") ? "roi" : "object",
  object_id: asciiObjectId(objectId),
  ...(resultSet === undefined ? {} : { result_set_id: resultSet }),
});

function anchorOf(target: CommentTarget): ThreadCreate["anchor"] {
  switch (target.kind) {
    case "point":
      return {
        kind: "point",
        geometry: { type: "Point", coordinates: [target.at.x, target.at.y] },
      };
    case "object":
      return objectAnchor(target.objectId, target.resultSet);
    case "shape":
    case "region":
      return { kind: "shape", geometry: { type: "Polygon", coordinates: [ring(target.extent)] } };
    case "selection":
      return {
        kind: "shape",
        geometry: {
          type: "MultiPolygon",
          coordinates: target.extents.map((extent) => [ring(extent)]),
        },
      };
    case "layer":
      return { kind: "layer", layer: target.layer };
  }
}

export function targetThread(
  target: CommentTarget,
  text: string,
  members: Pick<Mentionable, "id" | "name">[] = [],
): ThreadCreate | null {
  const body = text.trim();
  if (!body) return null;
  return { title: pinTitle(body), body: toMentionTokens(body, members), anchor: anchorOf(target) };
}
