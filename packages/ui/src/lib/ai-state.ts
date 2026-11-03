import { type StagingArea, type StagingCategory, stagingCategory } from "./analysis-parts.ts";
import {
  bandOf,
  type ConfidenceBand,
  effectiveMode,
  type TyperEvidence,
  type WordingMode,
} from "./confidence-words.ts";

export type AreaCall = "agree" | "disagree" | "unsure";

export type AiArea = StagingArea & {
  probability?: number;
  call?: AreaCall | null;
  measured?: number | null;
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

export type AiStateKind = "running" | "no-tumor" | "pre-read";

export type PreReadPhase = "open" | "settled";

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

export function rankAreas(areas: readonly AiArea[]): AiArea[] {
  return [...areas].sort((left, right) => right.size - left.size);
}

export function aiState({ areas, running = false }: AiStateInput): AiState {
  const ordered = rankAreas(areas);
  const leadIndex = ordered.findIndex((area) => area.call !== "disagree");
  const leadArea = ordered[leadIndex];
  const settled = leadArea !== undefined && leadArea.call === "agree" && leadArea.measured != null;
  const leadCategory = leadArea ? stagingCategory(shownSize(leadArea)) : null;
  const ranked: RankedArea[] = ordered.map((area, index) => {
    const category = stagingCategory(shownSize(area));
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
  if (running) return { kind: "running", areas: ranked };
  const lead = ranked[leadIndex];
  if (!lead) return { kind: "no-tumor", areas: ranked };
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
