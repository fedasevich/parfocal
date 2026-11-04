import type { CountsAsChange, Evaluation } from "@parfocal/api-client";
import { countsAsRule } from "@parfocal/ui/lib/counts-as-rule";
import { toReviewStyle } from "../review/decision-mapping.ts";

export const fixed = (value: number | null | undefined, decimals = 2) =>
  value == null ? "n/a" : value.toFixed(decimals);

export const headlineMetrics = [
  "sensitivity",
  "precision",
  "dice",
  "kappa",
  "cell-agreement",
] as const;

type HeadlineNumbers = Pick<
  Evaluation,
  "overall" | "dice" | "cell_agreement_with_ai" | "mean_kappa"
>;

export function headlineTiles(
  evaluation: HeadlineNumbers,
  metrics: readonly string[] = headlineMetrics,
  decimals = 2,
) {
  const region = evaluation.overall.find((row) => row.kind === "region") ?? evaluation.overall[0];
  const dice = Object.values(evaluation.dice)[0];
  const cells = evaluation.cell_agreement_with_ai.value;
  const tiles: Record<string, { value: string; label: string }> = {
    sensitivity: {
      value: fixed(region?.sensitivity.value, decimals),
      label: "Sensitivity, regions",
    },
    precision: { value: fixed(region?.precision.value, decimals), label: "Precision, regions" },
    dice: { value: fixed(dice?.value, decimals), label: "Dice, regions" },
    kappa: { value: fixed(evaluation.mean_kappa, decimals), label: "Cohen's κ, reviewers" },
    "cell-agreement": {
      value: cells == null ? "n/a" : `${Math.round(cells * 100)}%`,
      label: "Cells agreed",
    },
  };
  return metrics.flatMap((metric) => (tiles[metric] ? [tiles[metric]] : []));
}

const reasonLabel: Record<string, string> = {
  wrong_class: "Wrong cell type",
  boundary_off: "Boundary is off",
  not_class: "Not tumor",
  artefact: "Artefact or fold",
  two_regions: "Two regions, not one",
  not_a_cell: "Not a cell",
};

export const reasonRows = (evaluation: Pick<Evaluation, "reasons">) =>
  evaluation.reasons
    .map(([code, count]) => ({ label: reasonLabel[code] ?? code, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const scoreLabel: Record<string, string> = { "1": "1 · unusable", "5": "5 · sign as is" };

export const opinionRows = (evaluation: {
  opinions: readonly { counts: Record<string, number> }[];
}) => {
  const counts = evaluation.opinions[0]?.counts ?? {};
  return Object.keys(counts)
    .sort((a, b) => Number(a) - Number(b))
    .map((score) => ({ label: scoreLabel[score] ?? score, count: counts[score] ?? 0 }));
};

export const styleName = {
  certainty: "5-point certainty",
  agree: "Agree with the AI",
  yesno: "Yes or no",
  blind: "Pick the class blind",
} as const;

const answerName: Record<string, string> = {
  unsure: "Not sure",
  agree: "Agree",
  disagree: "Disagree",
  yes: "Yes",
  no: "No",
  class: "A class picked",
};

const countWord: Record<string, string> = {
  agree: "agree",
  disagree: "disagree",
  unsure: "not sure",
};

const longDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export const answerSpread = (evaluation: Pick<Evaluation, "decisions">) =>
  Object.entries(evaluation.decisions.answers)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([answer, count]) => `${answerName[answer] ?? answer} ${count}`)
    .join(", ");

export function methodsLines(
  evaluation: Evaluation,
  changes: CountsAsChange[],
  nameOf: (userId: string) => string,
): string[] {
  const { decisions } = evaluation;
  const style = toReviewStyle({ style: decisions.style, counts_as: decisions.counts_as });
  const lines = [
    `Reviewers answered in the ${styleName[style.kind]} style. ${countsAsRule(style.kind, style)}`,
  ];
  const counted = Object.entries(decisions.counted)
    .map(([value, count]) => `${count} ${countWord[value] ?? value}`)
    .join(", ");
  const spread = answerSpread(evaluation);
  if (counted)
    lines.push(`The decisions count as ${counted}. The answers as given were ${spread}.`);
  for (const change of changes) {
    const who = change.changed_by_user_id ? nameOf(change.changed_by_user_id) : "A researcher";
    lines.push(
      `${who} changed Counts as on ${longDay(change.changed_at)}. Every stored decision was counted again from the raw answers (${change.recounted} recounted).`,
    );
  }
  return lines;
}

export type ComparisonRow = { label: string; left: string; right: string; change: string };

const percent = (value: number | null | undefined) =>
  value == null ? "n/a" : `${Math.round(value * 100)}%`;

const points = (left: number | null | undefined, right: number | null | undefined) => {
  if (left == null || right == null) return "n/a";
  const diff = Math.round((right - left) * 100);
  return diff === 0 ? "same" : `${diff > 0 ? "+" : "-"}${Math.abs(diff)} points`;
};

const signed = (
  left: number | null | undefined,
  right: number | null | undefined,
  decimals: number,
) => {
  if (left == null || right == null) return "n/a";
  const diff = right - left;
  const text = Math.abs(diff).toFixed(decimals);
  if (Number(text) === 0) return "same";
  return `${diff > 0 ? "+" : "-"}${text}`;
};

export function comparisonRows(left: Evaluation, right: Evaluation, decimals = 2): ComparisonRow[] {
  const region = (evaluation: Evaluation) =>
    evaluation.overall.find((row) => row.kind === "region") ?? evaluation.overall[0];
  const dice = (evaluation: Evaluation) => Object.values(evaluation.dice)[0]?.value;
  const numeric: [string, number | null | undefined, number | null | undefined][] = [
    ["Sensitivity, regions", region(left)?.sensitivity.value, region(right)?.sensitivity.value],
    ["Precision, regions", region(left)?.precision.value, region(right)?.precision.value],
    ["Dice, regions", dice(left), dice(right)],
    ["Cohen's κ, reviewers", left.mean_kappa, right.mean_kappa],
  ];
  const rows = numeric.map(([label, a, b]) => ({
    label,
    left: fixed(a, decimals),
    right: fixed(b, decimals),
    change: signed(a, b, decimals),
  }));
  const cells = [left, right].map((item) => item.cell_agreement_with_ai.value);
  rows.push({
    label: "Cells agreed",
    left: percent(cells[0]),
    right: percent(cells[1]),
    change: points(cells[0], cells[1]),
  });
  const disagreed = [left.decisions.counted.disagree, right.decisions.counted.disagree];
  rows.push({
    label: "Counted as disagree",
    left: String(disagreed[0]),
    right: String(disagreed[1]),
    change: signed(disagreed[0], disagreed[1], 0),
  });
  return rows;
}
