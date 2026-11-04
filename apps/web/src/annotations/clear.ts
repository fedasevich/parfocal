import { type AnnotationDocument, listShapes, removeShape } from "./document.ts";
import type { ShapeId } from "./shapes.ts";

export const clearConfirmCount = 5000;

export interface Deletion {
  readonly document: AnnotationDocument;
  readonly removed: number;
  readonly orphanedThreads: readonly string[];
}

export function deleteShapes(doc: AnnotationDocument, ids: readonly ShapeId[]): Deletion {
  const doomed = new Set(ids.filter((id) => doc.shapes.has(id)));
  let document = doc;
  for (const id of doomed) document = removeShape(document, id);
  const orphanedThreads = [...doc.pins]
    .filter(([, placement]) => placement.shapeId !== null && doomed.has(placement.shapeId))
    .map(([threadId]) => threadId);
  return { document, removed: doomed.size, orphanedThreads };
}

export function clearAll(doc: AnnotationDocument): Deletion {
  return deleteShapes(
    doc,
    listShapes(doc).map((shape) => shape.id),
  );
}

export function needsClearConfirmation(count: number): boolean {
  return count > clearConfirmCount;
}

export function clearPrompt(count: number): string {
  return `Clear all ${count.toLocaleString("en-US")} shapes? Undo brings them back.`;
}
