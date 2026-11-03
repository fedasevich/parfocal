import { countsAsList } from "../review/decision-mapping.ts";

export type Range = { agreeFrom: number; disagreeTo: number };

export type Recount = { total: number; changed: number };

export const sameRange = (left: Range, right: Range) =>
  left.agreeFrom === right.agreeFrom && left.disagreeTo === right.disagreeTo;

export function recountOf(answers: Record<string, number>, from: Range, to: Range): Recount {
  const before = countsAsList(from.agreeFrom, from.disagreeTo);
  const after = countsAsList(to.agreeFrom, to.disagreeTo);
  let total = 0;
  let changed = 0;
  for (const [answer, count] of Object.entries(answers)) {
    total += count;
    const step = Number(answer) - 1;
    if (before[step] !== undefined && before[step] !== after[step]) changed += count;
  }
  return { total, changed };
}

export function splitOf(answers: Record<string, number>, range: Range) {
  const list = countsAsList(range.agreeFrom, range.disagreeTo);
  const split = { agree: 0, unsure: 0, disagree: 0 };
  for (const [answer, count] of Object.entries(answers)) {
    split[list[Number(answer) - 1] ?? "unsure"] += count;
  }
  return split;
}

export const recountText = ({ total, changed }: Recount) =>
  total === 0
    ? "No answers are stored yet, so nothing is recounted."
    : `Recounts ${changed} of ${total} ${total === 1 ? "answer" : "answers"}.`;
