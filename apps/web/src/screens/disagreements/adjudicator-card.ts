import type { AdjudicationObject, ReviewObject } from "@parfocal/api-client";
import type { ProjectClass } from "@parfocal/ui/lib/decision-answers";
import type { ReviewConfidence } from "../review/ai-wording.ts";
import type { ReviewStyle } from "../review/decision-mapping.ts";
import { cardText } from "../review/decision-style.ts";
import { adjudicatorWhy, answerTone, countOf, styledText, styledWord, type Tone } from "./text.ts";

export type Look = { style: ReviewStyle; classes: ProjectClass[] };

export type ReviewerLine = {
  letter: "A" | "B";
  text: string;
  tone: Tone;
  note: string | null;
};

export type AdjudicatorCard = {
  why: string;
  hiddenNote: string | null;
  above: string | null;
  headline: string;
  sub: string | null;
  reviewers: ReviewerLine[];
};

export const reviewObjectOf = (object: AdjudicationObject): ReviewObject => ({
  object: object.object,
  kind: object.kind,
  number: 1,
  class_name: object.ai.class_name,
  score: object.ai.score,
  size_mm: object.size_mm,
  other_class: null,
});

export function adjudicatorCard(
  object: AdjudicationObject,
  look: Look,
  confidence: ReviewConfidence,
): AdjudicatorCard {
  const aiClass = object.ai.class_name;
  const given = (
    [
      ["A", object.reviewer_a],
      ["B", object.reviewer_b],
    ] as const
  ).map(([letter, answer]) => {
    const counted = countOf(look.style, answer.raw, aiClass);
    return {
      counted,
      reason: answer.reason,
      line: {
        letter,
        text: styledText(look.style, answer, look.classes, aiClass),
        tone: answerTone[counted],
        note: answer.note,
      } satisfies ReviewerLine,
    };
  });
  const [a, b] = given;
  const text = cardText(look.style, reviewObjectOf(object), confidence);
  return {
    why: adjudicatorWhy(
      { raw: a?.counted ?? "unsure", reason: a?.reason ?? null },
      { raw: b?.counted ?? "unsure", reason: b?.reason ?? null },
    ),
    hiddenNote: text.hiddenNote,
    above: text.above,
    headline: text.question,
    sub: text.context ?? (object.kind === "cell" ? "Cell in the sample" : null),
    reviewers: given.map((item) => item.line),
  };
}

export const allDecidedHeading = (count: number, asker: string) =>
  `All ${count} decided. ${asker} is told.`;

export function decidedRows(objects: AdjudicationObject[], look: Look) {
  return objects.map((object) => {
    const raw = object.decision;
    return {
      object: object.object,
      kind: object.kind,
      word: raw === null ? null : styledWord(look.style, raw, look.classes, object.ai.class_name),
      tone: raw === null ? null : answerTone[countOf(look.style, raw, object.ai.class_name)],
    };
  });
}

export const sentNoteLine = (asker: string, note: string | null) =>
  note ? `${asker} wrote: ${note}` : null;
