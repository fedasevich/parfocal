import type { ReviewObject, Verdict } from "@parfocal/api-client";
import { type Count, type ReviewStyle, rawFor, reasonText } from "./decision-style.ts";
import type { SlideCounts } from "./review-top.tsx";

export type Answer = {
  value: Count;
  raw: string;
  reasons: string[];
  note: string | null;
};

export type Answers = Map<string, Answer | null>;

export function answerFromVerdict(
  verdict: Verdict,
  style: ReviewStyle,
  object: ReviewObject | undefined,
): Answer {
  return {
    value: verdict.value,
    raw: rawFor(style, verdict.value, object),
    reasons: verdict.reason ? [reasonText[verdict.reason] ?? verdict.reason] : [],
    note: verdict.note,
  };
}

export function baseAnswers(
  objects: ReviewObject[],
  verdicts: Map<string, Verdict>,
  style: ReviewStyle,
  stage: "empty" | "review" | "done",
  finishing: Record<string, Count>,
): Map<string, Answer> {
  const answers = new Map<string, Answer>();
  if (stage === "empty") return answers;
  for (const object of objects) {
    const verdict = verdicts.get(object.object);
    if (verdict) {
      answers.set(object.object, answerFromVerdict(verdict, style, object));
    } else if (stage === "done") {
      const value = finishing[object.object] ?? "agree";
      answers.set(object.object, {
        value,
        raw: rawFor(style, value, object),
        reasons: [],
        note: null,
      });
    }
  }
  return answers;
}

export function answerOf(base: Map<string, Answer>, overrides: Answers, object: string) {
  const override = overrides.get(object);
  if (override === null) return undefined;
  return override ?? base.get(object);
}

export function countAnswers(
  objects: ReviewObject[],
  answer: (object: string) => Answer | undefined,
): SlideCounts {
  const counts = { agree: 0, disagree: 0, unsure: 0, open: 0, total: objects.length, decided: 0 };
  for (const object of objects) {
    const value = answer(object.object)?.value;
    if (value) {
      counts[value] += 1;
      counts.decided += 1;
    } else {
      counts.open += 1;
    }
  }
  return counts;
}
