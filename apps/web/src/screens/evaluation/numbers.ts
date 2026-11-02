import type { CountsAsChange, Evaluation } from "@parfocal/api-client";
import { countsAsRule } from "@parfocal/ui/lib/counts-as-rule";
import { toReviewStyle } from "../review/decision-mapping.ts";

const two = (value: number | null | undefined) => (value == null ? "n/a" : value.toFixed(2));

export function headlineTiles(evaluation: Evaluation) {
  const region = evaluation.overall.find((row) => row.kind === "region") ?? evaluation.overall[0];
  const dice = Object.values(evaluation.dice)[0];
  const cells = evaluation.cell_agreement_with_ai.value;
  return [
    { value: two(region?.sensitivity.value), label: "Sensitivity, regions" },
    { value: two(region?.precision.value), label: "Precision, regions" },
    { value: two(dice?.value), label: "Dice, regions" },
    { value: two(evaluation.mean_kappa), label: "Cohen's κ, reviewers" },
    { value: cells == null ? "n/a" : `${Math.round(cells * 100)}%`, label: "Cells agreed" },
  ];
}

const reasonLabel: Record<string, string> = {
  wrong_class: "Wrong cell type",
  boundary_off: "Boundary is off",
  not_class: "Not tumor",
  artefact: "Artefact or fold",
  two_regions: "Two regions, not one",
  not_a_cell: "Not a cell",
};

export const reasonRows = (evaluation: Evaluation) =>
  evaluation.reasons
    .map(([code, count]) => ({ label: reasonLabel[code] ?? code, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const scoreLabel: Record<string, string> = { "1": "1 · unusable", "5": "5 · sign as is" };

export const opinionRows = (evaluation: Evaluation) => {
  const counts = evaluation.opinions[0]?.counts ?? {};
  return Object.keys(counts)
    .sort((a, b) => Number(a) - Number(b))
    .map((score) => ({ label: scoreLabel[score] ?? score, count: counts[score] ?? 0 }));
};

const styleName = {
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

export const answerSpread = (evaluation: Evaluation) =>
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
