import type { TaskDraft } from "../generated/api.ts";
import { notifications, type PersonKey, people, scenarioNow } from "./scenario.ts";

export type SentTask = {
  id: string;
  code: string;
  name: string;
  projectId: string;
  dueOn: string | null;
  reviewerIds: string[];
};

export const sentTasks: SentTask[] = [];

const personOf = (userId: string): PersonKey | undefined =>
  (Object.keys(people) as PersonKey[]).find((key) => people[key].id === userId);

export function recordSentTask(
  task: { id: string; code: string; projectId: string },
  draft: TaskDraft,
) {
  sentTasks.push({
    ...task,
    name: draft.name,
    dueOn: draft.due_on ?? null,
    reviewerIds: draft.reviewer_ids,
  });
  for (const userId of draft.reviewer_ids) {
    const to = personOf(userId);
    if (to === undefined) continue;
    notifications.push({
      to,
      id: crypto.randomUUID(),
      kind: "task-assigned",
      actor: "DH",
      title: "Daniel Hruška gave you a review task",
      detail: `${task.code} · ${draft.name}`,
      action: "Continue",
      createdAt: scenarioNow,
      read: false,
    });
  }
}
