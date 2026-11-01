import type { ReviewObject, DecisionStyle as TaskDecisionStyle } from "@parfocal/api-client";
import {
  answersFor,
  type DecisionAnswer,
  type ProjectClass,
  type DecisionStyle as StyleKind,
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

export const toReviewStyle = (style: TaskDecisionStyle | undefined): ReviewStyle =>
  style
    ? {
        kind: style.kind,
        question: style.question,
        agreeFrom: style.agree_from,
        disagreeTo: style.disagree_to,
      }
    : agreeWithTheAi;

export const showsClaim = (style: ReviewStyle) =>
  style.kind === "agree" || style.kind === "certainty";

export function answersOf(
  style: ReviewStyle,
  classes: ProjectClass[],
  object: ReviewObject | undefined,
): DecisionAnswer[] {
  return answersFor(style.kind, classes, object?.class_name, {
    agreeFrom: style.agreeFrom,
    disagreeTo: style.disagreeTo,
  });
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

export function rawLabel(style: ReviewStyle, raw: string, classes: ProjectClass[]): string {
  const answer = answersFor(style.kind, classes).find((item) => item.raw === raw);
  if (answer === undefined) return "";
  return style.kind === "certainty" ? `${answer.raw} · ${answer.label}` : answer.label;
}

export const countWord: Record<Count, string> = {
  agree: "Agree",
  disagree: "Disagree",
  unsure: "Not sure",
};

export const confidenceWord = (score: number) =>
  score >= 0.9
    ? "very sure"
    : score >= 0.7
      ? "fairly sure"
      : score >= 0.5
        ? "not very sure"
        : "unsure";

const anA = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

function sureText(object: ReviewObject, confidence: Confidence) {
  const percent = Math.round(object.score * 100);
  if (confidence === "number") return `, ${object.kind === "cell" ? "only " : ""}${percent}% sure`;
  if (confidence === "word") return `, ${confidenceWord(object.score)}`;
  return "";
}

export type CardText = {
  hiddenNote: string | null;
  above: string | null;
  question: string;
  context: string | null;
};

export function cardText(
  style: ReviewStyle,
  object: ReviewObject,
  confidence: Confidence,
): CardText {
  const cls = object.class_name.toLowerCase();
  const cell = object.kind === "cell";
  const sure = sureText(object, confidence);
  const size = object.size_mm === null ? null : `${object.size_mm.toFixed(1)} mm across`;
  const other =
    cell && object.other_class && confidence !== "hidden"
      ? `It could be ${object.other_class.toLowerCase()}.`
      : null;
  const context = cell ? other : size;
  if (style.kind === "certainty") {
    const claim = cell
      ? `${object.class_name} cell${sure}.${other ? ` ${other}` : ""}`
      : `${object.class_name}${sure} · ${size ?? ""}`;
    return {
      hiddenNote: null,
      above: claim,
      question: cell
        ? `How sure are you that this is ${anA(cls)} ${cls} cell?`
        : `How sure are you that ${object.object} is ${cls}?`,
      context: null,
    };
  }
  if (style.kind === "agree") {
    return {
      hiddenNote: null,
      above: null,
      question: cell
        ? `The AI says this is ${anA(cls)} ${cls} cell${sure}.`
        : `The AI says ${object.object} is ${cls}${sure}.`,
      context: confidence === "color" ? `Confidence as a color · ${context ?? ""}` : context,
    };
  }
  if (style.kind === "yesno") {
    return {
      hiddenNote: "The AI's claim is hidden in this task",
      above: null,
      question: style.question ?? "Is this tumor?",
      context: null,
    };
  }
  return {
    hiddenNote: "The AI's class is hidden in this task",
    above: null,
    question: cell ? "What is this cell?" : `What is ${object.object}?`,
    context: null,
  };
}

export const disagreeReasons: Record<ReviewObject["kind"], string[]> = {
  region: ["Not tumor", "Boundary is off", "Two regions, not one", "Artefact or fold"],
  cell: ["Not a cell", "It is an immune cell", "It is stroma", "Artefact"],
};

export const unsureReasons = [
  "Need a deeper level",
  "Need IHC",
  "Border unclear",
  "Out of focus",
  "Need a second look",
];

export const reasonText: Record<string, string> = {
  not_class: "Not tumor",
  boundary_off: "Boundary is off",
  two_regions: "Two regions, not one",
  artefact: "Artefact or fold",
  not_a_cell: "Not a cell",
  wrong_class: "It is an immune cell",
};
