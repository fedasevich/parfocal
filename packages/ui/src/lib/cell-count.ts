import { type CellCount, cellLine, countFirm } from "./ai-state.ts";
import { contestedness } from "./tumor-share.ts";

export type CountedCell = {
  probability: number;
  call?: "agree" | "disagree" | "unsure" | null;
};

export type CountPhase = "open" | "settled";

export type CellCountResult = CellCount & {
  phase: CountPhase;
  side: "over" | "under" | "either";
  toCheck: number;
};

const isChecked = (cell: CountedCell) => cell.call === "agree" || cell.call === "disagree";

export function cellCountRange(cells: readonly CountedCell[], sureCells: number): CellCount {
  let low = sureCells;
  let high = sureCells;
  for (const cell of cells) {
    if (cell.call === "disagree") continue;
    high += 1;
    low += cell.call === "agree" ? 1 : cell.probability;
  }
  return { low, high };
}

export function cellCountResult(cells: readonly CountedCell[], sureCells: number): CellCountResult {
  const range = cellCountRange(cells, sureCells);
  const firm = countFirm(range);
  const side = !firm ? "either" : range.low > cellLine ? "over" : "under";
  let toCheck = 0;
  if (!firm) {
    const order = cells
      .filter((cell) => !isChecked(cell))
      .map((cell) => cell.probability)
      .sort((a, b) => contestedness(b) - contestedness(a));
    let low = range.low;
    for (const probability of order) {
      if (low > cellLine) break;
      toCheck += 1;
      low += 1 - probability;
    }
  }
  return { ...range, phase: firm ? "settled" : "open", side, toCheck };
}

export function justSettled(before: CountPhase | null, after: CountPhase | null): boolean {
  return before === "open" && after === "settled";
}

export const settledToast = "You can stop here";

export function cellCountChipText(result: CellCountResult): string {
  const low = Math.round(result.low);
  const high = Math.round(result.high);
  const range = low === high ? `${low}` : `${low} to ${high}`;
  if (result.phase === "open") {
    return `About ${range} tumor cells, could be either side of ${cellLine}`;
  }
  const side = result.side === "over" ? "Over" : "Under";
  return `${side} ${cellLine} tumor cells (${range}), settled`;
}
