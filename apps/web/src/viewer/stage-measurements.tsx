import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { deleteShapes } from "../annotations/clear.ts";
import type { AnnotationDocument } from "../annotations/document.ts";
import type { ShapeId } from "../annotations/shapes.ts";
import { useLengthUnits } from "../measure/length-units.ts";
import { buildMeasurementRows } from "../measure/measurement-list.ts";
import { type InspectorSlots, InspectorSlotsProvider } from "./inspector-slots.tsx";

export type StageRuler = {
  readonly shapeId: ShapeId;
  readonly label: string;
  readonly length: string;
  readonly points: readonly number[];
};

export type StageMeasurements = {
  readonly rulers: readonly StageRuler[];
  readonly remove: (shapeId: ShapeId) => void;
  readonly claim: () => () => void;
  readonly claimed: boolean;
};

const MeasurementsContext = createContext<StageMeasurements | null>(null);

export function StageDockProvider({
  slots,
  measurements,
  children,
}: {
  slots: InspectorSlots;
  measurements: StageMeasurements;
  children: ReactNode;
}) {
  return (
    <InspectorSlotsProvider value={slots}>
      <MeasurementsContext.Provider value={measurements}>{children}</MeasurementsContext.Provider>
    </InspectorSlotsProvider>
  );
}

export const useRulersClaimed = () => useContext(MeasurementsContext)?.claimed ?? false;

const noTimes = new Map<ShapeId, number>();

export function useStageMeasurementsValue(
  saved: {
    readonly document: AnnotationDocument;
    readonly apply: (next: AnnotationDocument, label: string) => void;
  },
  micronsPerPixel: number | null,
  removeLabel: string,
) {
  const doc = saved.document;
  const { apply } = saved;
  const remove = useCallback(
    (id: ShapeId) => apply(deleteShapes(doc, [id]).document, removeLabel),
    [apply, doc, removeLabel],
  );
  const units = useLengthUnits();
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((count) => count + 1);
    return () => setClaims((count) => count - 1);
  }, []);
  const rulers = useMemo(
    () =>
      buildMeasurementRows(doc, micronsPerPixel, noTimes, undefined, units).flatMap((row) =>
        row.kind === "ruler"
          ? [
              {
                shapeId: row.shapeId,
                label: row.label,
                length: row.value,
                points: [...(doc.shapes.get(row.shapeId)?.points ?? [])],
              },
            ]
          : [],
      ),
    [doc, micronsPerPixel, units],
  );
  const claimed = claims > 0;
  return useMemo(() => ({ rulers, remove, claim, claimed }), [rulers, remove, claim, claimed]);
}

export function useStageRulers(active: boolean): StageMeasurements | null {
  const value = useContext(MeasurementsContext);
  const claim = active ? value?.claim : undefined;
  useEffect(() => claim?.(), [claim]);
  return active ? value : null;
}
