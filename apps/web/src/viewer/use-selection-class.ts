import { useLingui } from "@lingui/react/macro";
import type { ProjectClass } from "@parfocal/api-client";
import { useCallback, useMemo } from "react";
import { useClassKeys } from "../annotations/class-keys.ts";
import { pickClass, takesClass } from "../annotations/classes.ts";
import { takesActiveClass } from "../annotations/context-bar.ts";
import type { AnnotationDocument } from "../annotations/document.ts";
import type { ShapeId } from "../annotations/shapes.ts";

type Input = {
  readonly saved: {
    readonly document: AnnotationDocument;
    readonly apply: (next: AnnotationDocument, label: string) => void;
  };
  readonly tool: string;
  readonly selectedIds: readonly ShapeId[];
  readonly classes: readonly ProjectClass[];
  readonly activeClass: string | null;
  readonly setActiveClass: (classKey: string) => void;
};

export function useSelectionClass(input: Input) {
  const { t } = useLingui();
  const { saved, tool, selectedIds, classes, activeClass, setActiveClass } = input;
  const { document, apply } = saved;
  const selectionClass = useMemo(() => {
    const picked = selectedIds.flatMap((id) => {
      const shape = document.shapes.get(id);
      return shape === undefined || !takesClass(shape) ? [] : [shape.classKey];
    });
    return picked.length === 0
      ? undefined
      : picked.every((key) => key === picked[0])
        ? picked[0]
        : null;
  }, [document.shapes, selectedIds]);
  const selectionTakesClass = selectionClass !== undefined;
  const reclassSelection = useCallback(
    (classKey: string) => {
      const picked = pickClass(
        { document, selection: selectedIds, activeClass },
        classKey,
        "annotate",
      );
      if (picked.changed.length > 0) apply(picked.state.document, t`Change type`);
    },
    [document, apply, selectedIds, activeClass, t],
  );
  const pickClassKey = useCallback(
    (classKey: string) => {
      if (selectionTakesClass) reclassSelection(classKey);
      else setActiveClass(classKey);
    },
    [selectionTakesClass, reclassSelection, setActiveClass],
  );
  const pickSlot = useCallback(
    (slot: number) => {
      const picked = classes[slot - 1];
      if (picked !== undefined) pickClassKey(picked.id);
    },
    [classes, pickClassKey],
  );
  useClassKeys(pickSlot, takesActiveClass(tool) || selectionTakesClass);
  const stripClass = selectionTakesClass ? (selectionClass ?? null) : activeClass;
  return { stripClass, selectionTakesClass, pickClassKey };
}
