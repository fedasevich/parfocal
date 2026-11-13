import { type AnnotationDocument, addShape, removeShape, updateShape } from "./document.ts";
import type { LiveChange } from "./live-batch.ts";
import type { Remote } from "./save-queue.ts";
import { shapeOf } from "./saved-shapes.ts";
import { type ShapeId, singleRing } from "./shapes.ts";

export function applyLiveChanges(
  document: AnnotationDocument,
  remotes: Map<ShapeId, Remote>,
  changes: readonly LiveChange[],
): AnnotationDocument {
  const shapeIdOf = (annotationId: string) =>
    [...remotes].find(([, remote]) => remote.id === annotationId)?.[0];
  let next = document;
  for (const change of changes) {
    if (change.kind === "add") {
      const input = shapeOf(change.record);
      if (input === null) continue;
      const added = addShape(next, input);
      next = added.document;
      remotes.set(added.shape.id, { id: change.annotationId, version: change.record.version });
      continue;
    }
    const shapeId = shapeIdOf(change.annotationId);
    if (shapeId === undefined || !next.shapes.has(shapeId)) continue;
    if (change.kind === "remove") {
      next = removeShape(next, shapeId);
      remotes.delete(shapeId);
      continue;
    }
    const input = shapeOf(change.record);
    const remote = remotes.get(shapeId);
    if (input === null || remote === undefined) continue;
    next = updateShape(next, shapeId, {
      geometry: {
        points: input.points,
        ringStarts: input.ringStarts ?? singleRing(input.points).ringStarts,
      },
      ...(input.classKey === undefined ? {} : { classKey: input.classKey }),
      ...(input.text === undefined ? {} : { text: input.text }),
    }).document;
    remote.version = change.record.version;
  }
  return next;
}
