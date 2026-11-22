import { asciiObjectId } from "@parfocal/ui/lib/object-id";
import { createContext, useContext } from "react";
import type { AnnotationDocument } from "./document.ts";
import type { Shape, ShapeId } from "./shapes.ts";

export type ObjectLetter = "T" | "C" | "M";

export type DrawnObjectId = {
  readonly letter: ObjectLetter;
  readonly number: number | null;
  readonly shown: string;
  readonly ascii: string;
};

export type SavedCodes = ReadonlyMap<ShapeId, string>;

const personMark = "⁺";

const SavedCodesContext = createContext<SavedCodes | undefined>(undefined);

export const SavedCodesProvider = SavedCodesContext.Provider;

export const useSavedCodes = () => useContext(SavedCodesContext);

export function letterOfShape(shape: Shape): ObjectLetter | null {
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

const codePattern = /^([TCM])(\d+)(\+|⁺)?$/;

const idOf = (letter: ObjectLetter, number: number | null, person: boolean): DrawnObjectId => {
  const shown = `${letter}${number ?? ""}${person ? personMark : ""}`;
  return { letter, number, shown, ascii: asciiObjectId(shown) };
};

export function drawnObjectIds(
  doc: AnnotationDocument,
  codes?: SavedCodes,
): ReadonlyMap<ShapeId, DrawnObjectId> {
  const counters = { T: 0, C: 0, M: 0 };
  const ids = new Map<ShapeId, DrawnObjectId>();
  const shapes = [...doc.shapes.values()].sort((a, b) => a.id - b.id);
  for (const shape of shapes) {
    const letter = letterOfShape(shape);
    if (letter === null) continue;
    const saved = codes?.get(shape.id)?.match(codePattern);
    if (saved?.[1] !== undefined && saved[2] !== undefined) {
      ids.set(shape.id, idOf(saved[1] as ObjectLetter, Number(saved[2]), saved[3] !== undefined));
      continue;
    }
    if (codes !== undefined) {
      ids.set(shape.id, idOf(letter, null, letter !== "M"));
      continue;
    }
    counters[letter] += 1;
    ids.set(shape.id, idOf(letter, counters[letter], letter !== "M"));
  }
  return ids;
}
