import type { ReviewObject } from "@parfocal/api-client";
import {
  answersFor,
  type DecisionAnswer,
  type ProjectClass,
} from "@parfocal/ui/components/decision-buttons";
import { sureText } from "./ai-wording.ts";
import type { Confidence, Count, ReviewStyle } from "./decision-mapping.ts";

export * from "./decision-mapping.ts";

export const showsClaim = (style: ReviewStyle) =>
  style.kind === "agree" || style.kind === "certainty";

export function answersOf(
  style: ReviewStyle,
  classes: ProjectClass[],
  object: Pick<ReviewObject, "class_name"> | undefined,
): DecisionAnswer[] {
  return answersFor(style.kind, classes, object?.class_name, {
    agreeFrom: style.agreeFrom,
    disagreeTo: style.disagreeTo,
  });
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

const anA = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

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
  need_deeper_level: "Need a deeper level",
  need_ihc: "Need IHC",
  border_unclear: "Border unclear",
  out_of_focus: "Out of focus",
};
