import type { CountsAsChange, DecisionSettings, VerdictValue } from "../generated/api.ts";
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

const certaintyAnswers: Record<string, Record<string, number>> = {
  "RT-13": { "1": 2, "2": 4, "3": 5, "4": 8, "5": 9 },
};

type CountsAsStore = { countsAs: VerdictValue[]; changes: CountsAsChange[] };

const edited = new Map<string, CountsAsStore>();

export const decisionSettingsFor = (code: string): Required<DecisionSettings> => {
  const base = toDecisionSettings(decisionStyles[code] ?? fallback);
  const store = edited.get(code);
  return store ? { ...base, counts_as: store.countsAs } : base;
};

export const countsAsChangesFor = (code: string): CountsAsChange[] =>
  edited.get(code)?.changes ?? [];

export const answersFor = (code: string): Record<string, number> | null =>
  decisionSettingsFor(code).style === "certainty" ? (certaintyAnswers[code] ?? null) : null;

export const countedFromAnswers = (answers: Record<string, number>, countsAs: VerdictValue[]) => {
  const counted = { agree: 0, disagree: 0, unsure: 0 };
  for (const [answer, count] of Object.entries(answers)) {
    if (answer === "unsure") counted.unsure += count;
    else counted[countsAs[Number(answer) - 1] ?? "unsure"] += count;
  }
  return counted;
};

export const keepsAgreeAndDisagree = (countsAs: VerdictValue[]) =>
  countsAs.includes("agree") && countsAs.includes("disagree");

export const changeCountsAs = (
  code: string,
  after: VerdictValue[],
  changedBy: string,
  changedAt: string,
): CountsAsChange => {
  const before = decisionSettingsFor(code).counts_as;
  const answers = certaintyAnswers[code] ?? {};
  const recounted = Object.entries(answers).reduce(
    (sum, [answer, count]) =>
      before[Number(answer) - 1] === after[Number(answer) - 1] ? sum : sum + count,
    0,
  );
  const change: CountsAsChange = {
    changed_at: changedAt,
    changed_by_user_id: changedBy,
    before,
    after,
    recounted,
    reasons_dropped: 0,
  };
  edited.set(code, { countsAs: after, changes: [...countsAsChangesFor(code), change] });
  return change;
};

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
