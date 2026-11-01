import type { Evaluation } from "@parfocal/api-client";

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
  evaluation.reasons.map(([code, count]) => ({ label: reasonLabel[code] ?? code, count }));

const scoreLabel: Record<string, string> = { "1": "1 · unusable", "5": "5 · sign as is" };

export const opinionRows = (evaluation: Evaluation) => {
  const counts = evaluation.opinions[0]?.counts ?? {};
  return Object.keys(counts)
    .sort()
    .map((score) => ({ label: scoreLabel[score] ?? score, count: counts[score] ?? 0 }));
};
