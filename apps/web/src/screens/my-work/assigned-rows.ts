import type { AssignedTask, ReviewerProgress } from "@parfocal/api-client";
import { formatDue } from "../format.ts";

export type AssignedAction = "nudge" | "resolve" | "sign-off" | null;

export type AssignedTone = "warn" | "ok" | "accent" | "neutral";

export type AssignedLook = { tone: AssignedTone; action: AssignedAction };

export function assignedLook(task: AssignedTask): AssignedLook {
  switch (task.status) {
    case "disagreements":
      return { tone: "warn", action: "resolve" };
    case "ready-to-sign-off":
      return { tone: "ok", action: "sign-off" };
    case "signed-off":
      return { tone: "ok", action: null };
    case "in-review":
      return { tone: "accent", action: behindmost(task) ? "nudge" : null };
    case "not-started":
      return { tone: "neutral", action: behindmost(task) ? "nudge" : null };
  }
}

export const changeable = (task: AssignedTask) => task.status !== "signed-off";

const left = (reviewer: ReviewerProgress) => reviewer.slides_assigned - reviewer.slides_submitted;

export const behindmost = (task: AssignedTask): ReviewerProgress | undefined =>
  task.reviewers.reduce<ReviewerProgress | undefined>(
    (worst, reviewer) =>
      left(reviewer) > 0 && (worst === undefined || left(reviewer) > left(worst))
        ? reviewer
        : worst,
    undefined,
  );

const firstName = (name: string) => name.split(" ")[0] ?? name;

export function assignedNudgeMessage(name: string, task: AssignedTask, reviewer: ReviewerProgress) {
  const due = task.due_on ? ` is due ${formatDue(task.due_on)} and` : "";
  return `Hi ${firstName(name)}, ${task.code}${due} has ${left(reviewer)} slides left for you. Could you fit some in this week?`;
}
