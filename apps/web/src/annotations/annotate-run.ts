import type { JobStatus, ModelRun } from "@parfocal/api-client";

const ended: readonly JobStatus[] = ["done", "cancelled", "failed"];

export const runEnded = (status: JobStatus): boolean => ended.includes(status);

export function joinableSetOf(
  run: Pick<ModelRun, "status" | "task_id" | "slide_id" | "result_set_id">,
  task: { readonly taskId: string; readonly slideId: string },
): string | null {
  if (run.status !== "done" || run.task_id !== task.taskId || run.slide_id !== task.slideId) {
    return null;
  }
  return run.result_set_id;
}
