import type { ReviewObject } from "@parfocal/api-client";
import {
  type CellCountResult,
  type CountPhase,
  cellCountChipText,
  cellCountResult,
  justSettled,
  settledToast,
} from "@parfocal/ui/lib/cell-count";
import { cn } from "@parfocal/ui/lib/utils";
import { useEffect, useRef } from "react";
import { showUndoToast } from "../../shell/undo-toasts.tsx";
import type { Answer } from "./review-state.ts";

export const clusterSureCells = 154;

export function useCellCount(
  cells: readonly ReviewObject[],
  answer: (object: string) => Answer | undefined,
): CellCountResult | null {
  const result =
    cells.length === 0
      ? null
      : cellCountResult(
          cells.map((cell) => ({
            probability: cell.score,
            call: answer(cell.object)?.value ?? null,
          })),
          clusterSureCells,
        );
  const before = useRef<CountPhase | null>(null);
  const phase = result?.phase ?? null;
  useEffect(() => {
    if (justSettled(before.current, phase)) showUndoToast({ message: settledToast });
    before.current = phase;
  }, [phase]);
  return result;
}

export function CellCountChip({
  result,
  className,
}: {
  result: CellCountResult;
  className?: string;
}) {
  return (
    <output
      data-slot="cell-count-chip"
      data-phase={result.phase}
      data-side={result.side}
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-3 py-1 text-caption",
        result.phase === "settled"
          ? "border-line bg-chrome text-fg"
          : "border-line-strong bg-chrome text-fg-dim",
        className,
      )}
    >
      {cellCountChipText(result)}
    </output>
  );
}
