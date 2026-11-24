import {
  getReviewTask,
  listCases,
  listMyAdjudications,
  listMyJobs,
  listMyReviewTasks,
  listNotifications,
  listProjectSlides,
  listProjects,
  listReviewTasks,
  listTasksAssignedByMe,
} from "@parfocal/api-client";
import { rememberedId, rememberId } from "./tour-store.ts";

type Named = { id: string; name: string };
type Hit = { value: string; exact: boolean };
type Task = Named & { projectId: string };

export type ResolvedRoute = { route: string | null; exact: boolean };

const placeholder =
  /\{(project|task|task_project|task_slide|slide|case|case_project|adj_task|job|job_project|notification)(?::([^}|]*))?(?:\|([^}]+))?\}/g;

export const byName = <T extends Named>(items: readonly T[], name: string): T | undefined =>
  items.find((item) => item.name === name) ?? items[0];

async function projects(): Promise<Named[]> {
  const response = await listProjects();
  return response.status === 200 ? response.data : [];
}

const safely = async <T>(call: () => Promise<T[]>): Promise<T[]> => {
  try {
    return await call();
  } catch {
    return [];
  }
};

async function tasks(): Promise<Task[]> {
  const mine = await safely(async () => {
    const response = await listMyReviewTasks();
    return response.status === 200 ? response.data : [];
  });
  const assigned = await safely(async () => {
    const response = await listTasksAssignedByMe();
    return response.status === 200 ? response.data : [];
  });
  const own = [...mine, ...assigned].map((task) => ({
    id: task.id,
    name: task.name,
    projectId: task.project.id,
  }));
  const listed = await Promise.all(
    (await projects()).map((project) =>
      safely(async () => {
        const response = await listReviewTasks(project.id);
        return response.status === 200
          ? response.data.map((task) => ({ id: task.id, name: task.name, projectId: project.id }))
          : [];
      }),
    ),
  );
  return [...own, ...listed.flat()];
}

async function slideOf(projectName: string, label: string): Promise<Hit | undefined> {
  const project = byName(await projects(), projectName);
  if (project === undefined) return undefined;
  const response = await listProjectSlides(project.id);
  if (response.status !== 200) return undefined;
  const found = response.data.find((slide) => slide.label === label);
  const slide = found ?? response.data[0];
  return slide === undefined
    ? undefined
    : { value: slide.id, exact: found !== undefined && project.name === projectName };
}

async function caseHit(kind: string, label: string): Promise<Hit | undefined> {
  const response = await listCases();
  if (response.status !== 200) return undefined;
  const found = response.data.find((item) => item.label === label);
  const chosen = found ?? response.data[0];
  if (chosen === undefined) return undefined;
  return { value: kind === "case" ? chosen.id : chosen.project_id, exact: found !== undefined };
}

async function taskHit(kind: string, name: string, position: number): Promise<Hit | undefined> {
  const all = await tasks();
  const task = all.find((item) => item.name === name) ?? all[0];
  if (task === undefined) return undefined;
  const exact = task.name === name;
  if (kind === "task") return { value: task.id, exact };
  if (kind === "task_project") return { value: task.projectId, exact };
  const detail = await getReviewTask(task.id);
  if (detail.status !== 200) return undefined;
  const slide = detail.data.slides[position - 1] ?? detail.data.slides[0];
  return slide === undefined ? undefined : { value: slide.slide_id, exact };
}

const exactly = (value: string | undefined): Hit | undefined =>
  value === undefined ? undefined : { value, exact: true };

async function placeholderHit(kind: string, name: string, extra: string): Promise<Hit | undefined> {
  if (kind === "project") {
    const project = byName(await projects(), name);
    return project === undefined ? undefined : { value: project.id, exact: project.name === name };
  }
  if (kind === "slide") return slideOf(name, extra);
  if (kind === "case" || kind === "case_project") return caseHit(kind, name);
  if (kind === "adj_task") {
    const response = await listMyAdjudications();
    return exactly(response.status === 200 ? response.data[0]?.task_id : undefined);
  }
  if (kind === "job" || kind === "job_project") {
    const response = await listMyJobs();
    const job = response.status === 200 ? response.data[0] : undefined;
    return exactly(kind === "job" ? job?.id : job?.project.id);
  }
  if (kind === "notification") {
    const response = await listNotifications();
    return exactly(response.status === 200 ? response.data.notifications[0]?.id : undefined);
  }
  return taskHit(kind, name, Number(extra || 1));
}

async function lookup(kind: string, name: string, extra: string): Promise<Hit | undefined> {
  const key = `${kind}:${name}|${extra}`;
  const remembered = rememberedId(key);
  if (remembered !== undefined) return { value: remembered, exact: true };
  const found = await placeholderHit(kind, name, extra).catch(() => undefined);
  if (found?.exact) rememberId(key, found.value);
  return found;
}

export async function resolveRoute(route: string): Promise<ResolvedRoute> {
  let resolved = route;
  let exact = true;
  for (const [whole, kind = "", name = "", extra = ""] of route.matchAll(placeholder)) {
    const value = await lookup(kind, name, extra);
    if (value === undefined) return { route: null, exact: false };
    exact = exact && value.exact;
    resolved = resolved.replace(whole, value.value);
  }
  return { route: resolved, exact };
}
