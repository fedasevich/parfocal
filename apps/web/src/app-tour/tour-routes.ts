import {
  getReviewTask,
  listCases,
  listMyAdjudications,
  listMyJobs,
  listMyReviewTasks,
  listNotifications,
  listProjectSlides,
  listProjects,
} from "@parfocal/api-client";
import { rememberedId, rememberId } from "./tour-store.ts";

type Named = { id: string; name: string };

const placeholder =
  /\{(project|task|task_project|task_slide|slide|case|case_project|adj_task|job|job_project|notification)(?::([^}|]*))?(?:\|([^}]+))?\}/g;

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

async function slideOf(projectName: string, label: string): Promise<string | undefined> {
  const project = byName(await projects(), projectName);
  if (project === undefined) return undefined;
  const response = await listProjectSlides(project.id);
  if (response.status !== 200) return undefined;
  return (response.data.find((slide) => slide.label === label) ?? response.data[0])?.id;
}

async function caseOf(label: string) {
  const response = await listCases();
  if (response.status !== 200) return undefined;
  return response.data.find((item) => item.label === label) ?? response.data[0];
}

async function taskValue(kind: string, name: string, position: number) {
  const task = byName(await tasks(), name);
  if (task === undefined) return undefined;
  if (kind === "task") return task.id;
  if (kind === "task_project") return task.project.id;
  const detail = await getReviewTask(task.id);
  if (detail.status !== 200) return undefined;
  return detail.data.slides[position - 1]?.slide_id ?? detail.data.slides[0]?.slide_id;
}

async function lookup(kind: string, name: string, extra: string): Promise<string | undefined> {
  const key = `${kind}:${name}|${extra}`;
  const remembered = rememberedId(key);
  if (remembered !== undefined) return remembered;
  const found = await placeholderValue(kind, name, extra).catch(() => undefined);
  if (found !== undefined) rememberId(key, found);
  return found;
}

async function placeholderValue(
  kind: string,
  name: string,
  extra: string,
): Promise<string | undefined> {
  if (kind === "project") return byName(await projects(), name)?.id;
  if (kind === "slide") return slideOf(name, extra);
  if (kind === "case") return (await caseOf(name))?.id;
  if (kind === "case_project") return (await caseOf(name))?.project_id;
  if (kind === "adj_task") {
    const response = await listMyAdjudications();
    return response.status === 200 ? response.data[0]?.task_id : undefined;
  }
  if (kind === "job" || kind === "job_project") {
    const response = await listMyJobs();
    const job = response.status === 200 ? response.data[0] : undefined;
    return kind === "job" ? job?.id : job?.project.id;
  }
  if (kind === "notification") {
    const response = await listNotifications();
    return response.status === 200 ? response.data.notifications[0]?.id : undefined;
  }
  return taskValue(kind, name, Number(extra || 1));
}

export async function resolveRoute(route: string): Promise<string | null> {
  const found = [...route.matchAll(placeholder)];
  let resolved = route;
  for (const [whole, kind = "", name = "", extra = ""] of found) {
    const value = await lookup(kind, name, extra);
    if (value === undefined) return null;
    resolved = resolved.replace(whole, value);
  }
  return resolved;
}
