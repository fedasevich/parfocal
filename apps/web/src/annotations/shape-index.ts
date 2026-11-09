import { type AnnotationDocument, isShapeHidden, isShapeLocked } from "./document.ts";
import type { Extent, Shape } from "./shapes.ts";
import { type BoundsIndex, buildBoundsIndex } from "./spatial-index.ts";

interface ShapeIndex {
  readonly stack: readonly Shape[];
  readonly index: BoundsIndex;
}

const boundsPadding = 1;

const cache = new WeakMap<AnnotationDocument, ShapeIndex>();

function build(doc: AnnotationDocument): ShapeIndex {
  const stack: Shape[] = [];
  for (const shape of doc.shapes.values()) {
    if (!isShapeHidden(doc, shape) && !isShapeLocked(doc, shape)) stack.push(shape);
  }
  const bounds = new Float32Array(stack.length * 4);
  stack.forEach((shape, position) => {
    bounds.set(shape.bounds, position * 4);
  });
  return { stack, index: buildBoundsIndex(bounds) };
}

export function selectableCandidates(doc: AnnotationDocument, area: Extent): Shape[] {
  let entry = cache.get(doc);
  if (!entry) {
    entry = build(doc);
    cache.set(doc, entry);
  }
  const { stack, index } = entry;
  const positions: number[] = [];
  index.query(
    area[0] - boundsPadding,
    area[1] - boundsPadding,
    area[2] + boundsPadding,
    area[3] + boundsPadding,
    (position) => positions.push(position),
  );
  positions.sort((a, b) => a - b);
  const found: Shape[] = [];
  for (const position of positions) {
    const shape = stack[position];
    if (shape) found.push(shape);
  }
  return found;
}
