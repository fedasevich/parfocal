import type { Blocker } from "@parfocal/ui/components/before-you-list";
import type { OpinionQuestion } from "@parfocal/ui/components/slide-done-card";
import type { ReviewSession } from "./review-data.ts";

export function openBlockers(
  openRegions: readonly { object: string }[],
  openCells: number,
  jump: (target: string) => void,
): Blocker[] {
  return [
    ...openRegions.map((region) => ({
      id: region.object,
      text: `${region.object} is still open`,
      goTo: `Go to ${region.object}`,
      onGoTo: () => jump(region.object),
    })),
    ...(openCells
      ? [
          {
            id: "cells",
            text: `${openCells} cell${openCells === 1 ? "" : "s"} in the sample ${openCells === 1 ? "is" : "are"} still open`,
            goTo: "Go to the cells",
            onGoTo: () => jump("cells"),
          },
        ]
      : []),
  ];
}

export function opinionQuestions(
  session: ReviewSession,
  opinion: Record<string, string>,
  dropAnswers: readonly string[],
): OpinionQuestion[] {
  return (session.opinion?.questions ?? [])
    .filter((question) => !session.task?.ai_hidden_first_read || question.asked !== "first-read")
    .map((question) => {
      const answerText = opinion[question.key];
      const missing = question.required === true && !answerText && dropAnswers.length > 0;
      return {
        id: question.key,
        question: question.label,
        required: question.required ?? false,
        kind: question.kind,
        ...(question.kind === "choice" ? { options: question.options } : {}),
        ...(question.kind === "scale" && question.min_label && question.max_label
          ? {
              help: `${question.min ?? 1} ${question.min_label} · ${question.max ?? 5} ${question.max_label}`,
            }
          : {}),
        ...(answerText ? { answer: answerText } : {}),
        ...(missing ? { missing: true } : {}),
      };
    });
}

export function unsureBlockers(ids: readonly string[], jump: (target: string) => void): Blocker[] {
  return ids.map((id) => ({
    id,
    text: `${id} is not sure. The researcher sees it.`,
    goTo: `Go to ${id}`,
    onGoTo: () => jump(id),
  }));
}

export function questionBlockers(
  questions: readonly OpinionQuestion[],
  opinion: Record<string, string>,
): Blocker[] {
  return questions
    .map((question, position) => ({ question, position }))
    .filter(({ question }) => question.required && !opinion[question.id])
    .map(({ question, position }) => ({
      id: question.id,
      text: `Question ${position + 1} is not answered`,
      goTo: "Answer it",
      target: `[data-question="${question.id}"]`,
    }));
}
