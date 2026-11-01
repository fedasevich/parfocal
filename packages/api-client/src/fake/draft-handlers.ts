import { HttpResponse, http, type RequestHandler } from "msw";
import { type MyJob, myJobSchema } from "../draft/list-my-jobs.ts";
import { jobs, people, projectByCode } from "./scenario.ts";

export type DraftOperation = {
  operationId: string;
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  handler: () => RequestHandler;
};

const toMyJob = (job: (typeof jobs)[number]): MyJob => {
  const project = projectByCode(job.project);
  return myJobSchema.parse({
    id: job.id,
    kind: job.kind,
    title: `${job.title} · ${people[job.by].name}`,
    project: { id: project.id, code: project.code, name: project.name },
    status: job.status,
    units_done: job.unitsDone,
    units_total: job.unitsTotal,
    created_at: job.createdAt,
    finished_at: job.finishedAt,
  });
};

export const getListMyJobsMockHandler = (overrideResponse?: MyJob[]) =>
  http.get("*/api/me/jobs", () => HttpResponse.json(overrideResponse ?? jobs.map(toMyJob)));

export const draftOperations: DraftOperation[] = [
  {
    operationId: "listMyJobs",
    method: "get",
    path: "/api/me/jobs",
    handler: () => getListMyJobsMockHandler(),
  },
];

export const draftHandlers = (): RequestHandler[] =>
  draftOperations.map((operation) => operation.handler());
