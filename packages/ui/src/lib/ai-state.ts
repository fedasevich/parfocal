import {
  microMm,
  type StagingArea,
  type StagingCategory,
  stagingCategory,
} from "./analysis-parts.ts";
import {
  bandOf,
  type ConfidenceBand,
  effectiveMode,
  type TyperEvidence,
  type WordingMode,
} from "./confidence-words.ts";

export type AreaCall = "agree" | "disagree" | "unsure";

export type CellCount = { low: number; high: number };

export type AiArea = StagingArea & {
  probability?: number;
  call?: AreaCall | null;
  measured?: number | null;
  cells?: CellCount | null;
};

export type AiStateInput = {
  areas: readonly AiArea[];
  running?: boolean;
};

export type RankedArea = AiArea & {
  number: number;
  shownSize: number;
  category: StagingCategory;
  lead: boolean;
  canChangeCategory: boolean;
};

export type AiStateKind = "running" | "no-tumor" | "pre-read" | "small-cluster";

export type PreReadPhase = "open" | "settled";

export type ClusterStepName = "confirm" | "measure" | "count";

export type ClusterStep = { step: ClusterStepName; done: boolean };

export type AiState =
  | { kind: "running"; areas: RankedArea[] }
  | { kind: "no-tumor"; areas: RankedArea[] }
  | {
      kind: "pre-read";
      phase: PreReadPhase;
      areas: RankedArea[];
      lead: RankedArea;
      size: number;
      category: StagingCategory;
      pn: string;
    }
  | {
      kind: "small-cluster";
      phase: PreReadPhase;
      areas: RankedArea[];
      lead: RankedArea;
      size: number;
      category: StagingCategory;
      pn: string;
      steps: ClusterStep[];
    };

export const categoryName: Record<StagingCategory, string> = {
  macro: "Macrometastasis",
  micro: "Micrometastasis",
  ITC: "Isolated tumor cells",
};

export const suggestedPn: Record<StagingCategory, string> = {
  macro: "pN1a(sn)",
  micro: "pN1mi(sn)",
  ITC: "pN0(i+)(sn)",
};

const categoryRank: Record<StagingCategory, number> = { ITC: 0, micro: 1, macro: 2 };

export const shownSize = (area: AiArea) => area.measured ?? area.size;

export const cellLine = 200;

export const needsCount = (area: AiArea) => shownSize(area) <= microMm;

export const countFirm = (cells: CellCount | null | undefined) =>
  cells != null && (cells.high <= cellLine || cells.low > cellLine);

export function areaCategory(area: AiArea): StagingCategory {
  const size = shownSize(area);
  if (needsCount(area) && countFirm(area.cells) && (area.cells?.low ?? 0) > cellLine) {
    return "micro";
  }
  return stagingCategory(size);
}

export function rankAreas(areas: readonly AiArea[]): AiArea[] {
  return [...areas].sort((left, right) => shownSize(right) - shownSize(left));
}

export function aiState({ areas, running = false }: AiStateInput): AiState {
  const ordered = running ? [...areas] : rankAreas(areas);
  const leadIndex = ordered.findIndex((area) => area.call !== "disagree");
  const leadArea = ordered[leadIndex];
  const cluster = leadArea !== undefined && needsCount(leadArea);
  const steps: ClusterStep[] = leadArea
    ? [
        { step: "confirm", done: leadArea.call === "agree" },
        { step: "measure", done: leadArea.measured != null },
        { step: "count", done: countFirm(leadArea.cells) },
      ]
    : [];
  const settled =
    leadArea !== undefined &&
    leadArea.call === "agree" &&
    leadArea.measured != null &&
    (!cluster || countFirm(leadArea.cells));
  const leadCategory = leadArea ? areaCategory(leadArea) : null;
  const ranked: RankedArea[] = ordered.map((area, index) => {
    const category = areaCategory(area);
    const lead = index === leadIndex;
    const below =
      leadCategory !== null &&
      index > leadIndex &&
      categoryRank[category] <= categoryRank[leadCategory];
    return {
      ...area,
      number: index + 1,
      shownSize: shownSize(area),
      category,
      lead,
      canChangeCategory: !(settled && below && area.call !== "disagree"),
    };
  });
  if (running) return { kind: "running", areas: ranked.map((area) => ({ ...area, lead: false })) };
  const lead = ranked[leadIndex];
  if (!lead) return { kind: "no-tumor", areas: ranked };
  if (cluster) {
    return {
      kind: "small-cluster",
      phase: settled ? "settled" : "open",
      areas: ranked,
      lead,
      size: lead.shownSize,
      category: lead.category,
      pn: suggestedPn[lead.category],
      steps,
    };
  }
  return {
    kind: "pre-read",
    phase: settled ? "settled" : "open",
    areas: ranked,
    lead,
    size: lead.shownSize,
    category: lead.category,
    pn: suggestedPn[lead.category],
  };
}

const plainWord: Record<ConfidenceBand, string> = {
  confident: "likely",
  likely: "likely",
  unsure: "possible",
  doubtful: "unclear",
};

export const plainTyper: TyperEvidence = {
  name: "AI",
  calibrated: true,
  checkedOnHeldOut: true,
  bandAccuracy: {},
};

export function findingWords(
  label: string,
  probability: number | undefined,
  mode: WordingMode = "plain",
  typer: TyperEvidence = plainTyper,
): string {
  if (probability === undefined) return `${label} likely`;
  const band = bandOf(probability, typer.cutoffs);
  const used = effectiveMode(mode, typer);
  if (used === "percent") return `${label} ${Math.round(probability * 100)}%`;
  if (used === "frequency") {
    const accuracy = typer.bandAccuracy[band];
    return accuracy === undefined
      ? `${label}, not measured at this confidence`
      : `${label}, right about ${Math.round(accuracy * 10)} in 10 times`;
  }
  return `${label} ${plainWord[band]}`;
}
