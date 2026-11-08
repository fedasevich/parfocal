import type { ReviewObject, VerdictReason } from "@parfocal/api-client";
import type { DecisionAnswer, ProjectClass } from "@parfocal/ui/lib/decision-answers";
import { type Count, type ReviewStyle, rawFor } from "./decision-mapping.ts";
import { classPhrase } from "./disagree-reasons.ts";

export type TypeId = "keep" | "Tumor" | "Stroma" | "Immune" | "Other" | "notcell";

export type TypeOption = {
  id: TypeId;
  label: string;
  key: string;
  action: string;
  hint: string;
};

export const typeOptions: readonly TypeOption[] = [
  {
    id: "keep",
    label: "Keep",
    key: "K",
    action: "dagree",
    hint: "Keeps what the AI called this cell",
  },
  {
    id: "Tumor",
    label: "Tumor",
    key: "1",
    action: "dclass:1",
    hint: "Neoplastic cells, mitoses included",
  },
  {
    id: "Stroma",
    label: "Stroma",
    key: "2",
    action: "dclass:2",
    hint: "Fibroblasts, endothelial and smooth muscle cells",
  },
  {
    id: "Immune",
    label: "Immune",
    key: "3",
    action: "dclass:3",
    hint: "Lymphocytes, plasma cells, histiocytes, neutrophils and eosinophils",
  },
  {
    id: "Other",
    label: "Other",
    key: "4",
    action: "dclass:4",
    hint: "Benign epithelium, necrotic and apoptotic cells and any other cell",
  },
  {
    id: "notcell",
    label: "Not a cell",
    key: "X",
    action: "ddisagree",
    hint: "Debris, pigment, red blood cells, folds or blur",
  },
];

export type TypeChoice = {
  raw: string;
  value: Count;
  reasons: string[];
  draft: { reasons: VerdictReason[]; reason_class_id: string | null } | undefined;
};

export function typeChoice(
  style: ReviewStyle,
  option: TypeOption,
  cell: ReviewObject,
  classes: ProjectClass[],
): TypeChoice {
  if (option.id === "keep") {
    return { raw: rawFor(style, "agree", cell), value: "agree", reasons: [], draft: undefined };
  }
  if (option.id === "notcell") {
    return {
      raw: rawFor(style, "disagree", cell),
      value: "disagree",
      reasons: ["Not a cell"],
      draft: { reasons: ["not_a_cell"], reason_class_id: null },
    };
  }
  if (option.id === cell.class_name) {
    return {
      raw: style.kind === "blind" ? option.id : rawFor(style, "agree", cell),
      value: "agree",
      reasons: [],
      draft: undefined,
    };
  }
  return {
    raw: style.kind === "blind" ? option.id : rawFor(style, "disagree", cell),
    value: "disagree",
    reasons: [`It is ${classPhrase(option.id)}`],
    draft: {
      reasons: ["wrong_class"],
      reason_class_id: classes.find((item) => item.name === option.id)?.id ?? null,
    },
  };
}

export const typeAnswers: DecisionAnswer[] = [
  ...typeOptions.map((option) => ({
    raw: option.id,
    label: option.label,
    key: option.key,
    action: option.action,
  })),
  { raw: "unsure", label: "Not sure", key: "U", action: "dunsure", countsAs: "unsure" as const },
];

export function chosenType(
  style: ReviewStyle,
  cell: ReviewObject,
  classes: ProjectClass[],
  answer: { raw: string; reasons: string[] } | undefined,
): TypeId | undefined {
  if (answer === undefined) return undefined;
  return typeOptions.find((option) => {
    const choice = typeChoice(style, option, cell, classes);
    return choice.raw === answer.raw && choice.reasons.join() === answer.reasons.join();
  })?.id;
}
