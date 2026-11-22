import { asciiObjectId } from "@parfocal/ui/lib/object-id";
import type { AnnotationDocument } from "./document.ts";
import type { Shape, ShapeId } from "./shapes.ts";

export type DrawnObjectId = {
  readonly letter: "T" | "C" | "M";
  readonly number: number;
  readonly shown: string;
  readonly ascii: string;
};

const personMark = "⁺";

export function letterOfShape(shape: Shape): DrawnObjectId["letter"] | null {
  switch (shape.kind) {
    case "ruler":
      return "M";
    case "point":
      return "C";
    case "polygon":
    case "freehand":
    case "rectangle":
    case "ellipse":
    case "brush":
      return shape.provenance.kind === "model" && shape.provenance.typing !== undefined ? "C" : "T";
    case "arrow":
    case "text":
      return null;
  }
}

export function drawnObjectIds(doc: AnnotationDocument): ReadonlyMap<ShapeId, DrawnObjectId> {
  const counters = { T: 0, C: 0, M: 0 };
  const ids = new Map<ShapeId, DrawnObjectId>();
  const shapes = [...doc.shapes.values()].sort((a, b) => a.id - b.id);
  for (const shape of shapes) {
    const letter = letterOfShape(shape);
    if (letter === null) continue;
    counters[letter] += 1;
    const number = counters[letter];
    const shown = letter === "M" ? `M${number}` : `${letter}${number}${personMark}`;
    ids.set(shape.id, { letter, number, shown, ascii: asciiObjectId(shown) });
  }
  return ids;
}
