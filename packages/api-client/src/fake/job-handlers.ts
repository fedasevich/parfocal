import { HttpResponse, http, type RequestHandler } from "msw";
import { type MyJob, myJobSchema } from "../draft/list-my-jobs.ts";
import { type ModelRunDefaults, modelRunDefaultsSchema } from "../draft/model-runs.ts";
import {
  getListModelRunsMockHandler,
  getListProjectModelsMockHandler,
  getStartModelRunsMockHandler,
} from "../generated/api.msw.ts";
import type {
  JobStatus,
  ModelRun,
  ModelRunDraft,
  ProjectModel,
  RunStage,
} from "../generated/api.ts";
import type { DraftOperation } from "./draft-handlers.ts";
import { hiddenModelHandlers, isModelHidden } from "./hidden-models.ts";
import { fakeJobsState, updateJobsState } from "./jobs-scene.ts";
import { people, projectByCode, projects } from "./scenario.ts";
import {
  batchesFor,
  defaultRunModel,
  defaultRunSlideIds,
  type JobRow,
  jobsFor,
  type ModelKey,
  modelByKey,
  models,
  type ProjectSlideRef,
  type RunBatchSeed,
  type RunSlideSeed,
  runSteps,
  startedRunId,
  toSlideRef,
} from "./scenario-jobs.ts";

const projectCodeOf = (projectId: string) =>
  projects.find((project) => project.id === projectId || project.code === projectId)?.code;

export const toMyJob = (job: JobRow): MyJob => {
  const project = projectByCode(job.project);
  return myJobSchema.parse({
    id: job.id,
    kind: job.kind,
    title: job.title,
    project: { id: project.id, code: project.code, name: project.name },
    status: job.status,
    detail: job.detail,
    percent: job.percent,
    minutes_left: job.minutesLeft,
    units_done: job.unitsDone,
    units_total: job.unitsTotal,
    started_by_user_id: people[job.by].id,
    slides: job.slides,
    pause: job.pause,
    created_at: job.createdAt,
    finished_at: job.finishedAt,
  });
};

export const toMyJobs = (): MyJob[] => jobsFor(fakeJobsState()).map(toMyJob);

const stageStatus = (slide: RunSlideSeed, index: number): RunStage["status"] => {
  if (index < slide.at || slide.state === "done") return "done";
  if (index === slide.at && slide.state !== "waiting") return "running";
  return "pending";
};

const runStatus = (slide: RunSlideSeed): JobStatus =>
  slide.state === "waiting" ? "queued" : slide.state;

const actionsOf = (status: JobStatus): ModelRun["actions"] =>
  status === "paused"
    ? ["resume", "cancel"]
    : status === "done"
      ? []
      : status === "cancelled"
        ? ["retry"]
        : ["cancel"];

export function toModelRun(batch: RunBatchSeed, slide: RunSlideSeed): ModelRun {
  const project = projectByCode(batch.project);
  const model = modelByKey(batch.model);
  const status = runStatus(slide);
  return {
    id: slide.id,
    batch_id: batch.id,
    project_id: project.id,
    slide_id: slide.slideId,
    task_id: null,
    status,
    error_code: null,
    pause_reason: status === "paused" ? "server-not-answering" : null,
    scope: { kind: "slide" },
    parameters: { detector: { name: model.name, version: model.version } },
    result_set_id: null,
    started_by_user_id: people[batch.by].id,
    attempts: 1,
    created_at: batch.createdAt,
    finished_at: slide.state === "done" ? batch.finishedAt : null,
    stages: runSteps.map((name, index) => {
      const units = slide.units[index];
      const stage = stageStatus(slide, index);
      return {
        name,
        status: stage,
        runs: stage === "pending" ? 0 : 1,
        units_done: units?.[0] ?? 0,
        units_total: units?.[1] ?? null,
        started_at: stage === "pending" ? null : batch.createdAt,
        finished_at: stage === "done" ? (batch.finishedAt ?? batch.createdAt) : null,
      };
    }),
    actions: actionsOf(status),
  };
}

export const toModelRuns = (projectId: string, batchId?: string | null): ModelRun[] => {
  const code = projectCodeOf(projectId);
  return batchesFor(fakeJobsState())
    .filter((batch) => batch.project === code && (!batchId || batch.id === batchId))
    .flatMap((batch) => batch.slides.map((slide) => toModelRun(batch, slide)));
};

const runById = (runId: string) => {
  for (const batch of batchesFor(fakeJobsState())) {
    const slide = batch.slides.find((item) => item.id === runId);
    if (slide) return { batch, slide };
  }
  return undefined;
};

const allRunsById = (runId: string) => {
  for (const batch of batchesFor({ ...fakeJobsState(), cancelled: [] })) {
    const slide = batch.slides.find((item) => item.id === runId);
    if (slide) return { batch, slide };
  }
  return undefined;
};

const shownModels = () => models.filter((model) => !isModelHidden(model.name));

export const toProjectModels = (): ProjectModel[] =>
  shownModels().map(
    (model): ProjectModel => ({
      id: model.id,
      name: model.name,
      version: model.version,
      title: model.title,
      description: model.description,
      makes: model.makes,
      minutes_per_slide: model.minutesPerSlide,
      measured: false,
      host: model.host,
      server: model.server,
      runs_ahead: model.runsAhead,
      queue_minutes: model.queueMinutes,
      latency_ms: model.latencyMs,
    }),
  );

export const toModelRunDefaults = (): ModelRunDefaults =>
  modelRunDefaultsSchema.parse({
    slide_ids: defaultRunSlideIds,
    model_id: (
      shownModels().find((model) => model.key === defaultRunModel) ??
      shownModels()[0] ??
      modelByKey(defaultRunModel)
    ).id,
  });

const modelKeyOf = (name: string): ModelKey =>
  models.find((model) => model.name === name)?.key ?? defaultRunModel;

export function startRuns(draft: ModelRunDraft): ModelRun[] {
  const slides = draft.slide_ids
    .map(toSlideRef)
    .filter((slide): slide is ProjectSlideRef => slide !== undefined);
  const model = modelKeyOf(draft.parameters.detector?.name ?? "");
  updateJobsState((state) => ({
    ...state,
    started: { slides, model },
    cancelled: state.cancelled.filter((id) => id !== startedRunId),
  }));
  return toModelRuns(projectByCode("P07").id, startedRunId);
}

type RunParams = { projectId: string; runId: string };

const notFound = () =>
  HttpResponse.json(
    { type: "about:blank", title: "Model run not found", status: 404, code: "not-found" },
    { status: 404, headers: { "content-type": "application/problem+json" } },
  );

export const getGetModelRunDefaultsMockHandler = (overrideResponse?: ModelRunDefaults) =>
  http.get("*/api/projects/:projectId/model-runs/defaults", () =>
    HttpResponse.json(overrideResponse ?? toModelRunDefaults()),
  );

export const getMoveModelRunMockHandler = () =>
  http.post<RunParams>("*/api/projects/:projectId/model-runs/:runId/move", ({ params }) => {
    const found = runById(params.runId);
    if (found === undefined) return notFound();
    updateJobsState((state) => ({ ...state, resumed: "moved" }));
    const moved = runById(params.runId);
    return HttpResponse.json(moved ? toModelRun(moved.batch, moved.slide) : null);
  });

export const getListMyJobsMockHandler = (overrideResponse?: MyJob[]) =>
  http.get("*/api/me/jobs", () => HttpResponse.json(overrideResponse ?? toMyJobs()));

export const jobDraftOperations: DraftOperation[] = [
  {
    operationId: "listMyJobs",
    method: "get",
    path: "/api/me/jobs",
    handler: () => getListMyJobsMockHandler(),
  },
  {
    operationId: "getModelRunDefaults",
    method: "get",
    path: "/api/projects/{project_id}/model-runs/defaults",
    handler: () => getGetModelRunDefaultsMockHandler(),
  },
  {
    operationId: "moveModelRun",
    method: "post",
    path: "/api/projects/{project_id}/model-runs/{run_id}/move",
    handler: () => getMoveModelRunMockHandler(),
  },
];

const cancelled = (run: ModelRun): ModelRun => ({
  ...run,
  status: "cancelled",
  actions: ["retry"],
});

export function jobHandlers(): RequestHandler[] {
  return [
    ...hiddenModelHandlers(),
    getListModelRunsMockHandler(({ params, request }) =>
      toModelRuns(String(params.projectId), new URL(request.url).searchParams.get("batch_id")),
    ),
    http.get<RunParams>("*/api/projects/:projectId/model-runs/:runId", ({ params }) => {
      const found = runById(params.runId);
      return found ? HttpResponse.json(toModelRun(found.batch, found.slide)) : notFound();
    }),
    getListProjectModelsMockHandler(() => toProjectModels()),
    getStartModelRunsMockHandler(async ({ request }) =>
      startRuns((await request.json()) as ModelRunDraft),
    ),
    http.post<RunParams>("*/api/projects/:projectId/model-runs/:runId/cancel", ({ params }) => {
      const found = runById(params.runId);
      if (found === undefined) return notFound();
      updateJobsState((state) => ({
        ...state,
        cancelled: [...state.cancelled, found.batch.id],
      }));
      return HttpResponse.json(cancelled(toModelRun(found.batch, found.slide)));
    }),
    http.post<RunParams>("*/api/projects/:projectId/model-runs/:runId/resume", ({ params }) => {
      const found = allRunsById(params.runId);
      if (found === undefined) return notFound();
      const wasCancelled = fakeJobsState().cancelled.includes(found.batch.id);
      updateJobsState((state) =>
        wasCancelled
          ? { ...state, cancelled: state.cancelled.filter((id) => id !== found.batch.id) }
          : { ...state, resumed: "resumed" },
      );
      const resumed = runById(params.runId) ?? found;
      return HttpResponse.json(toModelRun(resumed.batch, resumed.slide));
    }),
  ];
}
