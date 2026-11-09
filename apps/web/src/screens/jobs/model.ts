import type { ModelRun, MyJob, ProjectModel, RunStage } from "@parfocal/api-client";
import { daysBetween, formatClock, formatDayMonth } from "../format.ts";

export type ProgressTone = "accent" | "ok" | "warn" | "bad";

export type JobStep = {
  label: string;
  detail: string | undefined;
  state: "done" | "current" | "held" | "waiting";
  percent: number;
  valueText: string;
};

export const andJoin = (labels: string[]) =>
  labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const numberWords = ["no", "one", "two", "three", "four", "five"];

const countWord = (count: number) => numberWords[count] ?? String(count);

const isRunning = (job: MyJob) => job.status === "running" || job.status === "queued";

export const isFinished = (job: MyJob) =>
  job.status === "done" || job.status === "cancelled" || job.status === "failed";

export function trayPercent(jobs: MyJob[]): number {
  const running = jobs.filter((job) => !isFinished(job));
  if (running.length === 0) return 0;
  return Math.round(running.reduce((sum, job) => sum + job.percent, 0) / running.length);
}

export function trayValueText(job: MyJob): string {
  if (job.status === "failed") return "Failed";
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "done") return "Done";
  if (job.status === "paused") return `Paused at ${job.percent}%`;
  if (job.percent < 5 && job.minutes_left !== null) return `Starting · ${job.minutes_left} min`;
  return job.minutes_left === null
    ? `${job.percent}%`
    : `${job.percent}% · ${job.minutes_left} min left`;
}

export function finishedWhen(at: Date, today: Date): string {
  const minutes = (today.getTime() - at.getTime()) / 60000;
  if (minutes < 5) return "just now";
  const days = daysBetween(at, today);
  if (days === 0) return `today ${formatClock(at)}`;
  if (days === 1) return "yesterday";
  return formatDayMonth(at);
}

export const pauseText = (job: MyJob) =>
  job.pause?.reason === "server-not-answering" || job.pause?.reason === "server-busy"
    ? "the lab server is busy"
    : "paused";

export function trayDetail(job: MyJob, today: Date): string {
  if (job.status === "paused") return `${job.detail} · ${pauseText(job)}`;
  if (isFinished(job) && job.finished_at) {
    return `${job.detail} · ${finishedWhen(new Date(job.finished_at), today)}`;
  }
  return job.detail;
}

export function trayTone(job: MyJob): ProgressTone {
  if (job.status === "failed") return "bad";
  if (job.status === "cancelled" || job.status === "paused") return "warn";
  return job.status === "done" ? "ok" : "accent";
}

export type JobIcon = "smart" | "upload" | "link";

export const jobIcon = (job: MyJob): JobIcon =>
  job.kind === "model-run" ? "smart" : job.kind === "import" ? "link" : "upload";

export type JobTarget =
  | { kind: "job"; projectId: string; jobId: string }
  | { kind: "upload"; projectId: string; scene: "progress" | "done" }
  | { kind: "project"; projectId: string };

export function jobTarget(job: MyJob, newestUploadId: string | undefined): JobTarget {
  if (job.kind === "model-run") return { kind: "job", projectId: job.project.id, jobId: job.id };
  if (job.id !== newestUploadId) return { kind: "project", projectId: job.project.id };
  return {
    kind: "upload",
    projectId: job.project.id,
    scene: isRunning(job) ? "progress" : "done",
  };
}

export const runningJobs = (jobs: MyJob[]) => jobs.filter((job) => !isFinished(job));

export const finishedJobs = (jobs: MyJob[]) => jobs.filter(isFinished);

const stageDone = (stage: RunStage) => stage.status === "done";

export const stepsDone = (run: ModelRun) => run.stages.filter(stageDone).length;

const currentIndex = (run: ModelRun) => run.stages.findIndex((stage) => !stageDone(stage));

const share = (stage: RunStage | undefined) =>
  stage?.units_total ? stage.units_done / stage.units_total : 0;

export const stagePercent = (stage: RunStage | undefined) => Math.round(share(stage) * 100);

export function slidePercent(run: ModelRun): number {
  if (run.status === "done") return 100;
  const at = currentIndex(run);
  const stage = run.stages[at];
  if (run.status === "paused") return stagePercent(stage);
  if (run.status === "queued") return 0;
  return Math.round(((at + share(stage)) / run.stages.length) * 100);
}

export function slideValueText(run: ModelRun): string {
  if (run.status === "done") return "Done";
  if (run.status === "paused") return "Paused";
  if (run.status === "queued") return "Waiting";
  return run.stages[currentIndex(run)]?.name ?? "Running";
}

export function slideTone(run: ModelRun): ProgressTone {
  if (run.status === "done") return "ok";
  return run.status === "paused" ? "warn" : "accent";
}

const thousands = (count: number) => count.toLocaleString("en-US");

function stageDetail(
  stage: RunStage,
  index: number,
  context: { model: ProjectModel | undefined; resultSet: string },
): string | undefined {
  const shown = stage.status !== "pending";
  if (!shown) return undefined;
  switch (index) {
    case 0:
      return stage.units_done > 0 && context.model
        ? `${countWord(stage.units_done)} run ahead, ${context.model.queue_minutes} min`
        : undefined;
    case 1:
      return stage.units_total ? `${stage.units_total} levels` : undefined;
    case 2:
      return stage.units_done > 0 ? `${stage.units_done} mm²` : undefined;
    case 3:
      return stage.status === "done"
        ? "all tiles"
        : `tile ${thousands(stage.units_done)} of ${thousands(stage.units_total ?? 0)}`;
    case 4:
      return stage.status === "done" ? `${thousands(stage.units_done)} cells` : undefined;
    case 5:
      return stage.status === "done" ? `C1 to C${stage.units_done}` : undefined;
    case 6:
      return stage.status === "done" && stage.finished_at
        ? `${context.resultSet} · ${formatDayMonth(new Date(stage.finished_at))}`
        : undefined;
    default:
      return undefined;
  }
}

export function stepsOf(
  run: ModelRun,
  context: { model: ProjectModel | undefined; resultSet: string },
): JobStep[] {
  return run.stages.map((stage, index) => {
    const held = run.status === "paused" && stage.status === "running";
    const current = run.status === "running" && stage.status === "running";
    const state = stageDone(stage) ? "done" : held ? "held" : current ? "current" : "waiting";
    return {
      label: stage.name,
      detail: stageDetail(stage, index, context),
      state,
      percent: stagePercent(stage),
      valueText: held ? "paused" : `${stagePercent(stage)}%`,
    };
  });
}

export const canOpenSlide = (run: ModelRun) => stepsDone(run) >= 4;

export const pausedRuns = (runs: ModelRun[]) => runs.filter((run) => run.status === "paused");

export const cancellableRuns = (runs: ModelRun[]) =>
  runs.filter((run) => run.actions.includes("cancel"));

export type RunSummary = {
  state: "running" | "paused" | "done";
  percent: number;
  text: string;
};

export function runSummary(job: MyJob): RunSummary {
  if (job.status === "done") {
    const minutes =
      job.finished_at === null
        ? 0
        : Math.round(
            (new Date(job.finished_at).getTime() - new Date(job.created_at).getTime()) / 60000,
          );
    return { state: "done", percent: 100, text: `Done in ${minutes} min` };
  }
  if (job.status === "paused") {
    return { state: "paused", percent: job.percent, text: `Paused at ${job.percent}%` };
  }
  const percent = job.percent;
  if (percent < 5) {
    return {
      state: "running",
      percent,
      text: `Starting · about ${job.minutes_left ?? 0} min`,
    };
  }
  return {
    state: "running",
    percent,
    text: `${percent}% · about ${job.minutes_left ?? 0} min left`,
  };
}

export function startedText(job: MyJob, by: string, today: Date): string {
  const at = new Date(job.created_at);
  const days = daysBetween(at, today);
  const when =
    days === 0 ? `started ${formatClock(at)}` : days === 1 ? "yesterday" : formatDayMonth(at);
  return days === 0 ? `${when} by ${by}` : `${when} ${formatClock(at)} by ${by}`;
}

export type RunEstimate = { total: number; doneAround: string; perSlide: string };

export function runEstimate(model: ProjectModel, slides: number, now: Date): RunEstimate {
  const total = model.minutes_per_slide * slides;
  const wait = model.host === "lab" ? 0 : model.queue_minutes;
  const doneAround = formatClock(new Date(now.getTime() + (total + wait) * 60000));
  const perSlide =
    model.serving === "offline"
      ? `${model.server} is not answering right now, so this run cannot start.`
      : model.host === "lab"
        ? `About ${model.minutes_per_slide} min a slide on ${model.server}, which answers now in ${model.latency_ms ?? 0} ms.`
        : `About ${model.minutes_per_slide} min a slide on the ${model.server}. ${model.runs_ahead === 1 ? "One run is" : `${model.runs_ahead} runs are`} ahead of yours, about ${model.queue_minutes} min.`;
  return { total, doneAround, perSlide };
}

export const makesLabel = { regions: "Regions", cells: "Cells", heatmap: "Heatmap" } as const;
