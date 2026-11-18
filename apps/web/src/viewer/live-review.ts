import { opinionQuestions } from "../screens/review/guided-blockers.ts";
import type { ReviewSession } from "../screens/review/review-data.ts";
import type { LiveDecisionSplit } from "./live-slides.ts";

export type LiveReview = {
  readonly slideName: string;
  readonly split: LiveDecisionSplit & { readonly decided: number; readonly total: number };
  readonly added: readonly string[];
  readonly submitReason: string | undefined;
};

const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function submitReason(
  openObjects: readonly string[],
  openQuestions: readonly number[],
): string | undefined {
  const open = openObjects.length + openQuestions.length;
  if (open === 0) return undefined;
  if (open === 1) {
    return openObjects.length === 1
      ? `${openObjects[0]} is still open.`
      : `Question ${openQuestions[0]} is not answered.`;
  }
  const parts = [
    ...(openObjects.length > 0 ? [countOf(openObjects.length, "object")] : []),
    ...(openQuestions.length > 0 ? [countOf(openQuestions.length, "question")] : []),
  ];
  return `${parts.join(" and ")} are still open.`;
}

const answered = (value: unknown) => value !== undefined && value !== null && value !== "";

export function liveReview(session: ReviewSession): LiveReview | undefined {
  if (!session.ready) return undefined;
  const split = { agree: 0, disagree: 0, unsure: 0, open: 0 };
  const openObjects: string[] = [];
  for (const object of session.objects) {
    const value = session.decisions.get(object.object)?.value;
    if (value === "agree" || value === "disagree" || value === "unsure") split[value] += 1;
    else openObjects.push(object.object);
  }
  const saved: Record<string, unknown> = session.opinion?.answers ?? {};
  const openQuestions = opinionQuestions(session, {}, []).flatMap((question, index) =>
    question.required && !answered(saved[question.id]) ? [index + 1] : [],
  );
  return {
    slideName: session.slideName,
    split: {
      ...split,
      open: openObjects.length,
      decided: session.objects.length - openObjects.length,
      total: session.objects.length,
    },
    added: session.added.map((item) => item.object),
    submitReason: submitReason(openObjects, openQuestions),
  };
}
