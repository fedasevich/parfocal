import { getReviewTask, listMyReviewTasks, listProjects } from "@parfocal/api-client";

type Named = { id: string; name: string };

const placeholder = /\{(project|task|task_project|task_slide):([^}|]+)(?:\|(\d+))?\}/g;

export const byName = <T extends Named>(items: readonly T[], name: string): T | undefined =>
  items.find((item) => item.name === name) ?? items[0];

async function projects(): Promise<Named[]> {
  const response = await listProjects();
  return response.status === 200 ? response.data : [];
}

async function tasks() {
  const response = await listMyReviewTasks();
  return response.status === 200 ? response.data : [];
}

async function placeholderValue(
  kind: string,
  name: string,
  position: number,
): Promise<string | undefined> {
  if (kind === "project") return byName(await projects(), name)?.id;
  const task = byName(await tasks(), name);
  if (task === undefined) return undefined;
  if (kind === "task") return task.id;
  if (kind === "task_project") return task.project.id;
  const detail = await getReviewTask(task.id);
  if (detail.status !== 200) return undefined;
  return detail.data.slides[position - 1]?.slide_id ?? detail.data.slides[0]?.slide_id;
}

export async function resolveRoute(route: string): Promise<string | null> {
  const found = [...route.matchAll(placeholder)];
  let resolved = route;
  for (const [whole, kind = "", name = "", position] of found) {
    const value = await placeholderValue(kind, name, Number(position ?? 1));
    if (value === undefined) return null;
    resolved = resolved.replace(whole, value);
  }
  return resolved;
}
