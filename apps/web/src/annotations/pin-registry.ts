import type { AnnotationDocument } from "./document.ts";
import { pinPoint } from "./pins.ts";
import type { Point } from "./polygon-draft.ts";

export interface PinRegistry {
  anchors: ReadonlyMap<string, Point>;
  open: (threadId: string) => void;
  remove: (threadIds: readonly string[], proceed: () => void) => void;
}

export function createPinRegistry(): PinRegistry {
  return {
    anchors: new Map(),
    open: () => undefined,
    remove: (_threadIds, proceed) => proceed(),
  };
}

export function pinPointsOf(
  registry: PinRegistry,
  doc: AnnotationDocument,
): ReadonlyMap<string, Point> {
  const points = new Map<string, Point>();
  for (const [threadId, anchor] of registry.anchors) {
    const point = pinPoint(doc, threadId, anchor);
    if (point !== null) points.set(threadId, point);
  }
  return points;
}
