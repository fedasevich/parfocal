import { asciiObjectId } from "@parfocal/ui/lib/object-id";
import type { AnnotationDocument } from "../annotations/document.ts";
import type { SavedCodes } from "../annotations/drawn-object-ids.ts";
import type { ShapeId } from "../annotations/shapes.ts";
import type { SlideAreaEntry } from "./slide-areas.ts";
import { outlineArea, type StageArea } from "./stage-geometry.ts";

const cellPattern = /^(?:T[1-9]\d*[.])?C([1-9]\d*)[a-z]*$/i;

export function cellNumberOf(object: string | undefined): number | null {
  if (object === undefined) return null;
  const found = asciiObjectId(object).match(cellPattern);
  return found?.[1] === undefined ? null : Number(found[1]);
}

export type ObjectFocus = {
  readonly area: StageArea;
  readonly shape: ShapeId | null;
};

export function drawnFocusOf(
  object: string,
  codes: SavedCodes,
  document: AnnotationDocument,
): ObjectFocus | null {
  const wanted = asciiObjectId(object).toUpperCase();
  for (const [id, code] of codes) {
    if (asciiObjectId(code).toUpperCase() !== wanted) continue;
    const bounds = document.shapes.get(id)?.bounds;
    const area = bounds === undefined ? null : outlineArea([...bounds]);
    if (area !== null) return { area, shape: id };
  }
  return null;
}

export function areaFocusOf(object: string, areas: readonly SlideAreaEntry[]): ObjectFocus | null {
  const wanted = asciiObjectId(object).toUpperCase();
  const found = areas.find((entry) => asciiObjectId(entry.object).toUpperCase() === wanted);
  if (found === undefined) return null;
  const { x, y, width, height } = found.bounds;
  const area = outlineArea([x, y, x + width, y + height]);
  return area === null ? null : { area, shape: null };
}
