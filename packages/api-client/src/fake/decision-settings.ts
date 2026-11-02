import type { DecisionSettings, VerdictValue } from "../generated/api.ts";
import { decisionStyles, type ScenarioDecisionStyle } from "./scenario-review.ts";

const apiStyles = {
  certainty: "certainty",
  agree: "agree",
  yesno: "yes-no",
  blind: "blind",
} as const;

export const countsAsFrom = (agreeFrom: number, disagreeTo: number): VerdictValue[] =>
  [1, 2, 3, 4, 5].map((step) =>
    step >= agreeFrom ? "agree" : step <= disagreeTo ? "disagree" : "unsure",
  );

export const toDecisionSettings = (style: ScenarioDecisionStyle): Required<DecisionSettings> => ({
  style: apiStyles[style.kind],
  counts_as: countsAsFrom(style.agreeFrom, style.disagreeTo),
  question: style.question,
});

const fallback: ScenarioDecisionStyle = {
  kind: "agree",
  question: null,
  agreeFrom: 4,
  disagreeTo: 2,
};

export const decisionSettingsFor = (code: string): Required<DecisionSettings> =>
  toDecisionSettings(decisionStyles[code] ?? fallback);

export const countedAs = (
  settings: Required<DecisionSettings>,
  answer: string,
  pickedClassId: string | null | undefined,
  aiClassKey: number | undefined,
): VerdictValue => {
  if (answer === "unsure") return "unsure";
  if (settings.style === "certainty") return settings.counts_as[Number(answer) - 1] ?? "unsure";
  if (settings.style === "agree") return answer === "disagree" ? "disagree" : "agree";
  if (settings.style === "yes-no") return answer === "yes" ? "agree" : "disagree";
  return aiClassKey !== undefined && pickedClassId?.endsWith(`-class-${aiClassKey}`)
    ? "agree"
    : "disagree";
};
