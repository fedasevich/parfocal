import type { Thread } from "@parfocal/api-client";
import { anchorWords } from "./anchor-words.ts";
import { anchorReferenceName, type Reference } from "./comment-references.ts";
import type { AnnotationDocument } from "./document.ts";
import { drawnObjectIds, type SavedCodes } from "./drawn-object-ids.ts";

export function anchorReferences(threads: readonly Thread[]): Reference[] {
  const counted = { Region: 0, Selection: 0 };
  return [...threads]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((thread) => {
      if (thread.anchor.kind !== "shape") return [];
      const words = anchorWords(thread.anchor, () => undefined);
      if (words.label !== "Region" && words.label !== "Selection") return [];
      const index = counted[words.label];
      counted[words.label] = index + 1;
      return [
        {
          id: thread.id,
          text: anchorReferenceName(words.label, index),
          sub: words.kind,
          reach: { kind: "anchor", anchor: thread.anchor },
        },
      ];
    });
}

export function drawnReferences(
  doc: AnnotationDocument,
  codes: SavedCodes | undefined,
): Reference[] {
  if (codes === undefined) return [];
  return [...drawnObjectIds(doc, codes).values()]
    .filter((item) => item.number !== null)
    .map((item) => ({
      id: item.shown,
      text: item.shown,
      sub: "Object",
      reach: { kind: "object", id: item.shown },
    }));
}
