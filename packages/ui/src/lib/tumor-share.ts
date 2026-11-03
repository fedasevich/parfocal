export const CONTESTED = 0.2;
export const DEFAULT_CUTOFF = 0.2;

export type CellEvidence = {
  probability: number;
  calledTumor: boolean;
  checked?: boolean;
};

export type CutoffSide = "above" | "below" | "either";

export type ResultState = "firm" | "open" | "settled";

export type TumorShareResult = {
  typed: number;
  share: number;
  low: number;
  high: number;
  cutoff: number;
  side: CutoffSide;
  state: ResultState;
  toCheck: number;
};

const contestedness = (probability: number) => Math.min(probability, 1 - probability);

export function sideOf(low: number, high: number, cutoff: number): CutoffSide {
  if (low >= cutoff) return "above";
  if (high < cutoff) return "below";
  return "either";
}

const settledProbability = (cell: CellEvidence) =>
  cell.checked ? Number(cell.calledTumor) : cell.probability;

export function tumorShareResultFor(
  cells: readonly CellEvidence[],
  cutoff: number = DEFAULT_CUTOFF,
): TumorShareResult | null {
  const typed = cells.length;
  if (typed === 0) return null;
  const probabilities = cells.map(settledProbability);
  let tumorCalls = 0;
  let low = 0;
  let high = 0;
  cells.forEach((cell, index) => {
    const probability = probabilities[index] ?? 0;
    if (cell.calledTumor) {
      tumorCalls += 1;
      low += probability;
      high += 1;
    } else {
      high += probability;
    }
  });
  const side = sideOf(low / typed, high / typed, cutoff);
  let toCheck = 0;
  if (side === "either") {
    const order = cells
      .map((cell, index) => ({ cell, probability: probabilities[index] ?? 0 }))
      .filter(({ probability }) => contestedness(probability) > 0)
      .sort((a, b) => contestedness(b.probability) - contestedness(a.probability));
    let walkLow = low;
    let walkHigh = high;
    while (
      sideOf(walkLow / typed, walkHigh / typed, cutoff) === "either" &&
      toCheck < order.length
    ) {
      const next = order[toCheck];
      toCheck += 1;
      if (!next) break;
      if (next.cell.calledTumor) walkLow += 1 - next.probability;
      else walkHigh -= next.probability;
    }
  }
  const anyChecked = cells.some((cell) => cell.checked);
  const state: ResultState = side === "either" ? "open" : anyChecked ? "settled" : "firm";
  return {
    typed,
    share: tumorCalls / typed,
    low: low / typed,
    high: high / typed,
    cutoff,
    side,
    state,
    toCheck,
  };
}

const percentOf = (value: number) => `${Math.round(value * 100)}%`;

export function resultChipText(result: TumorShareResult): string {
  const cutoff = percentOf(result.cutoff);
  if (result.side === "either") {
    return `Could be either side of ${cutoff}, check the unsure cells`;
  }
  const side = result.side === "above" ? "Above" : "Below";
  return `${side} ${cutoff} whatever the unsure cells are`;
}

export function resultRangeText(result: TumorShareResult): string {
  return `Tumor cells: ${percentOf(result.share)} of ${result.typed.toLocaleString("en-US")} typed. Counting its likely mistakes either way, between ${percentOf(result.low)} and ${percentOf(result.high)}.`;
}

export type CellTaxonomy = "none" | "sentinel-node" | "pannuke";

export type TumorShareSettings = {
  tumor_share_cutoff: number;
  tumor_share_result_sentinel_node: boolean;
  tumor_share_result_pannuke: boolean;
};

export function tumorShareCutoffFor(
  taxonomy: CellTaxonomy,
  settings: TumorShareSettings,
): number | null {
  const switchedOn =
    taxonomy === "pannuke"
      ? settings.tumor_share_result_pannuke
      : taxonomy === "sentinel-node"
        ? settings.tumor_share_result_sentinel_node
        : false;
  return switchedOn ? settings.tumor_share_cutoff / 100 : null;
}

export function tumorShareResultForCase(
  taxonomy: CellTaxonomy,
  settings: TumorShareSettings,
  cells: readonly CellEvidence[],
): TumorShareResult | null {
  const cutoff = tumorShareCutoffFor(taxonomy, settings);
  return cutoff === null ? null : tumorShareResultFor(cells, cutoff);
}
