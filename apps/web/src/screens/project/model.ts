import type { TaskStates } from "@parfocal/api-client";

export type NewClass = { name: string; colour: string; key: number };

export function classErrors(
  name: string,
  key: string,
  taken: Pick<NewClass, "name" | "key">[],
): { name?: string; key?: string } {
  const errors: { name?: string; key?: string } = {};
  const trimmed = name.trim();
  if (!trimmed) errors.name = "Give the class a name.";
  else if (taken.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) {
    errors.name = `${trimmed} is already a class here.`;
  }
  if (!/^[1-9]$/.test(key.trim())) errors.key = "Pick a number key from 1 to 9.";
  else {
    const clash = taken.find((item) => String(item.key) === key.trim());
    if (clash) errors.key = `${key.trim()} already picks ${clash.name}.`;
  }
  return errors;
}

type ReviewerProgress = { userId: string; done: number; total: number };

const doneStates = new Set(["submitted", "disagreement-queue", "signed-off", "exported"]);

export function reviewerProgress(states: TaskStates | undefined): ReviewerProgress[] {
  const tally = new Map<string, ReviewerProgress>();
  for (const slide of states?.slides ?? []) {
    for (const reviewer of slide.reviewers) {
      const row = tally.get(reviewer.user_id) ?? { userId: reviewer.user_id, done: 0, total: 0 };
      row.total += 1;
      if (doneStates.has(reviewer.state)) row.done += 1;
      tally.set(reviewer.user_id, row);
    }
  }
  return [...tally.values()];
}

type TaskLook = { label: string; tone: "accent" | "neutral" | "ok" };

export function taskStatus(states: TaskStates | undefined, progress: ReviewerProgress[]): TaskLook {
  if (states?.signed_off_at) return { label: "Signed off", tone: "ok" };
  if (progress.length > 0 && progress.every((row) => row.done === row.total)) {
    return { label: "Ready to sign off", tone: "ok" };
  }
  if (progress.some((row) => row.done > 0)) return { label: "In review", tone: "accent" };
  return { label: "Assigned", tone: "neutral" };
}
