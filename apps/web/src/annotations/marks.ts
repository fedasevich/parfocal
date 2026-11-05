import { type AnnotationDocument, addShape } from "./document.ts";
import type { Point } from "./polygon-draft.ts";
import { at, type Shape, type ShapeId } from "./shapes.ts";

export const arrowHeadScreenPixels = 14;

export const arrowHeadSpread = Math.PI / 7;

export const maxTextLength = 200;

export type ArrowEnds = { readonly from: Point; readonly to: Point };

export type TextDraft = {
  readonly point: Point;
  readonly text: string;
  readonly id?: ShapeId;
};

export function addArrow(doc: AnnotationDocument, ends: ArrowEnds): AnnotationDocument {
  return addShape(doc, {
    kind: "arrow",
    points: Float32Array.of(ends.from.x, ends.from.y, ends.to.x, ends.to.y),
  }).document;
}

export function cleanText(raw: string): string {
  return raw.trim().slice(0, maxTextLength);
}

export function addText(doc: AnnotationDocument, draft: TextDraft): AnnotationDocument {
  const text = cleanText(draft.text);
  if (text === "") return doc;
  return addShape(doc, {
    kind: "text",
    points: Float32Array.of(draft.point.x, draft.point.y),
    text,
  }).document;
}

export function arrowsOf(doc: AnnotationDocument): Shape[] {
  return [...doc.shapes.values()].filter((shape) => shape.kind === "arrow");
}

export function textsOf(doc: AnnotationDocument): Shape[] {
  return [...doc.shapes.values()].filter((shape) => shape.kind === "text");
}

export function arrowEndsOf(shape: Shape): ArrowEnds {
  return {
    from: { x: at(shape.points, 0), y: at(shape.points, 1) },
    to: { x: at(shape.points, 2), y: at(shape.points, 3) },
  };
}

export function textPointOf(shape: Shape): Point {
  return { x: at(shape.points, 0), y: at(shape.points, 1) };
}

export function arrowHead(from: Point, to: Point, length = arrowHeadScreenPixels): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (turn: number): Point => ({
    x: to.x - Math.cos(angle + turn) * length,
    y: to.y - Math.sin(angle + turn) * length,
  });
  return [wing(arrowHeadSpread), wing(-arrowHeadSpread)];
}
