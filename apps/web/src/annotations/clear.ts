import {
  type AnnotationDocument,
  groupChain,
  listShapes,
  removeGroup,
  removeShape,
} from "./document.ts";
import type { GroupId, ShapeId } from "./shapes.ts";

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

function groupsHolding(doc: AnnotationDocument): Set<GroupId> {
  const held = new Set<GroupId>();
  for (const shape of doc.shapes.values()) {
    for (const group of groupChain(doc, shape.groupId)) held.add(group.id);
  }
  return held;
}

export function withoutEmptiedGroups(
  before: AnnotationDocument,
  after: AnnotationDocument,
): AnnotationDocument {
  const heldBefore = groupsHolding(before);
  const heldAfter = groupsHolding(after);
  let document = after;
  for (const id of after.groups.keys()) {
    if (heldBefore.has(id) && !heldAfter.has(id)) document = removeGroup(document, id);
  }
  return document;
}

export function clearAll(doc: AnnotationDocument): Deletion {
  const deletion = deleteShapes(
    doc,
    listShapes(doc).map((shape) => shape.id),
  );
  return { ...deletion, document: withoutEmptiedGroups(doc, deletion.document) };
}

export function needsClearConfirmation(count: number): boolean {
  return count > clearConfirmCount;
}

export function clearPrompt(count: number): string {
  return `Clear all ${count.toLocaleString("en-US")} shapes? Undo brings them back.`;
}
