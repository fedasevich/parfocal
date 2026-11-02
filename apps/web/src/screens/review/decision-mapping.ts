import type { DecisionSettings, ReviewObject, Verdict, VerdictDraft } from "@parfocal/api-client";
import type {
  ProjectClass,
  DecisionStyle as StyleKind,
} from "@parfocal/ui/components/decision-buttons";

export type Count = "agree" | "disagree" | "unsure";

export type ReviewStyle = {
  kind: StyleKind;
  question: string | null;
  agreeFrom: number;
  disagreeTo: number;
};

export type Confidence = "number" | "word" | "color" | "hidden";

export const agreeWithTheAi: ReviewStyle = {
  kind: "agree",
  question: null,
  agreeFrom: 4,
  disagreeTo: 2,
};

const kindOfApi = {
  certainty: "certainty",
  agree: "agree",
  "yes-no": "yesno",
  blind: "blind",
} as const;

export const apiStyleOf = {
  certainty: "certainty",
  agree: "agree",
  yesno: "yes-no",
  blind: "blind",
} as const satisfies Record<StyleKind, NonNullable<DecisionSettings["style"]>>;

export function toReviewStyle(settings: DecisionSettings | undefined): ReviewStyle {
  if (settings?.style === undefined) return agreeWithTheAi;
  const mapping = settings.counts_as ?? [];
  const firstAgree = mapping.indexOf("agree");
  const lastDisagree = mapping.lastIndexOf("disagree");
  return {
    kind: kindOfApi[settings.style],
    question: settings.question ?? null,
    agreeFrom: firstAgree < 0 ? agreeWithTheAi.agreeFrom : firstAgree + 1,
    disagreeTo: lastDisagree < 0 ? agreeWithTheAi.disagreeTo : lastDisagree + 1,
  };
}

export function countsAsList(agreeFrom: number, disagreeTo: number): Count[] {
  return [1, 2, 3, 4, 5].map((step) =>
    step >= agreeFrom ? "agree" : step <= disagreeTo ? "disagree" : "unsure",
  );
}

export function decisionSettings(
  style: StyleKind,
  range: { agreeFrom: number; disagreeTo: number },
  question: string | null = null,
): DecisionSettings {
  return {
    style: apiStyleOf[style],
    counts_as: countsAsList(range.agreeFrom, range.disagreeTo),
    question: style === "yesno" ? question : null,
  };
}

export function decisionBody(
  style: ReviewStyle,
  raw: string,
  classes: ProjectClass[],
  value: Count,
): VerdictDraft {
  if (style.kind === "agree") return { value };
  if (style.kind !== "blind" || raw === "unsure") return { answer: raw };
  const picked = classes.find((item) => item.name === raw)?.id;
  return picked === undefined ? { answer: raw } : { answer: "class", answer_class_id: picked };
}

export function rawOfDecision(
  style: ReviewStyle,
  verdict: Verdict,
  classes: ProjectClass[],
  object: ReviewObject | undefined,
): string {
  if (kindOfApi[verdict.style] !== style.kind) return rawFor(style, verdict.value, object);
  if (verdict.answer !== "class") return verdict.answer;
  return classes.find((item) => item.id === verdict.answer_class_id)?.name ?? verdict.answer;
}

export function countsAs(style: ReviewStyle, raw: string, object: ReviewObject | undefined): Count {
  if (raw === "unsure") return "unsure";
  if (style.kind === "agree") return raw === "disagree" ? "disagree" : "agree";
  if (style.kind === "yesno") return raw === "yes" ? "agree" : "disagree";
  if (style.kind === "blind") return raw === object?.class_name ? "agree" : "disagree";
  const value = Number(raw);
  if (value >= style.agreeFrom) return "agree";
  if (value <= style.disagreeTo) return "disagree";
  return "unsure";
}

export function rawFor(style: ReviewStyle, count: Count, object: ReviewObject | undefined): string {
  if (style.kind === "certainty") {
    return count === "agree" ? "4" : count === "disagree" ? "2" : "3";
  }
  if (count === "unsure") return "unsure";
  if (style.kind === "agree") return count;
  if (style.kind === "yesno") return count === "agree" ? "yes" : "no";
  const claimed = object?.class_name ?? "Tumor";
  return count === "agree" ? claimed : claimed === "Tumor" ? "Stroma" : "Tumor";
}
