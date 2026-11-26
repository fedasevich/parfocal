import type { Thread } from "@parfocal/api-client";
import { sameObjectId } from "@parfocal/ui/lib/object-id";
import type { SlideArea } from "@parfocal/viewer-engine";
import type { SlideAreaEntry } from "../viewer/slide-areas.ts";
import { threadTarget } from "../viewer/thread-target.ts";
import { areaOfExtent } from "./comment-target.ts";
import type { AnnotationDocument } from "./document.ts";
import type { SavedCodes } from "./drawn-object-ids.ts";
import { membersOf, shapeKey, unionBounds } from "./layers-tree.ts";
import type { ShapeId } from "./shapes.ts";

export type AnchorPlace = {
  readonly doc: AnnotationDocument;
  readonly codes: SavedCodes | undefined;
  readonly areas: readonly SlideAreaEntry[];
};

type Anchor = Thread["anchor"];

export function shapeOfObject(place: AnchorPlace, objectId: string): ShapeId | null {
  for (const [shapeId, code] of place.codes ?? []) {
    if (sameObjectId(code, objectId) && place.doc.shapes.has(shapeId)) return shapeId;
  }
  return null;
}

export function anchorShapes(anchor: Anchor, place: AnchorPlace): ShapeId[] {
  if (anchor.kind === "layer" && anchor.layer) return membersOf(place.doc, anchor.layer);
  if (anchor.object_id) {
    const shape = shapeOfObject(place, anchor.object_id);
    return shape === null ? [] : [shape];
  }
  return [];
}

export function anchorArea(anchor: Anchor, place: AnchorPlace): SlideArea | null {
  const shapes = anchorShapes(anchor, place);
  if (shapes.length > 0) return areaOfExtent(unionBounds(place.doc, shapes));
  if (anchor.kind === "layer") return null;
  return threadTarget(anchor, place.areas);
}

export function anchorCorner(anchor: Anchor, place: AnchorPlace): { x: number; y: number } | null {
  const area = anchorArea(anchor, place);
  return area === null ? null : { x: area.x + area.width, y: area.y };
}

export function anchorRowKey(anchor: Anchor, place: AnchorPlace): string | null {
  if (anchor.kind === "layer") return anchor.layer ?? null;
  if (!anchor.object_id) return null;
  const shape = shapeOfObject(place, anchor.object_id);
  return shape === null ? null : shapeKey(shape);
}
