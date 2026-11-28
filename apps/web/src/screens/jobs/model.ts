import type { ModelRun, MyJob, ProjectModel, RunStage, SlideEstimate } from "@parfocal/api-client";
import { daysBetween, formatClock, formatDayMonth } from "../format.ts";
import { projectedEstimate } from "./projected-estimate.ts";

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

const failureTexts: Record<string, string> = {
  "model-not-served": "this model has no worker yet",
  "too-many-claims": "the worker stopped three times",
  "run-objects-lost": "the model found objects but none were stored",
};

export const failureText = (code: string | null) =>
  code === null ? "no reason was recorded" : (failureTexts[code] ?? code.replaceAll("-", " "));

export function trayValueText(job: MyJob): string {
  if (job.status === "failed") return `Failed, ${failureText(job.error_code)}`;
  if (job.status === "cancelled") return "Cancelled";
  if (job.status === "done") return "Done";
  if (job.status === "paused") return `Paused at ${job.percent}%`;
  if (job.status === "queued") return waitText(job);
  const left = knownMinutes(job.minutes_left);
  if (job.percent < 5 && left !== null) return `Starting · ${left} min`;
  return left === null ? `${job.percent}%` : `${job.percent}% · ${left} min left`;
}

export const knownMinutes = (minutes: number | null | undefined): number | null =>
  minutes === null || minutes === undefined || minutes <= 0 ? null : minutes;

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

const waitTexts = {
  "waiting-for-gpu": "Waiting for a GPU",
  "gpu-busy": "Waiting, the GPU is busy",
  "woken-again": "Starting the GPU again",
} as const;

export const waitText = (job: MyJob) =>
  job.status === "queued" && job.wait ? waitTexts[job.wait.reason] : "Waiting to start";

export function trayDetail(job: MyJob, today: Date): string {
  if (job.status === "paused") return `${job.detail} · ${pauseText(job)}`;
  if (job.status === "queued" && job.wait) {
    return `${job.detail} · queued since ${formatClock(new Date(job.wait.since))}`;
  }
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
  | { kind: "upload"; projectId: string; scene: "progress" }
  | { kind: "project"; projectId: string }
  | { kind: "slide"; projectId: string; slideId: string };

export function jobTarget(job: MyJob, newestUploadId: string | undefined): JobTarget {
  if (job.kind === "model-run") return { kind: "job", projectId: job.project.id, jobId: job.id };
  if (job.id !== newestUploadId) return { kind: "project", projectId: job.project.id };
  if (!isRunning(job)) return { kind: "job", projectId: job.project.id, jobId: job.id };
  return { kind: "upload", projectId: job.project.id, scene: "progress" };
}

export function finishedTarget(job: MyJob): JobTarget {
  const [only, ...more] = job.slides;
  if (only && more.length === 0) {
    return { kind: "slide", projectId: job.project.id, slideId: only.id };
  }
  if (job.kind === "model-run") return { kind: "job", projectId: job.project.id, jobId: job.id };
  return { kind: "project", projectId: job.project.id };
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
  if (run.status === "failed") return "Failed";
  if (run.status === "cancelled") return "Cancelled";
  if (run.status === "paused") return "Paused";
  if (run.status === "queued") return "Waiting";
  return run.stages[currentIndex(run)]?.name ?? "Running";
}

export function slideTone(run: ModelRun): ProgressTone {
  if (run.status === "done") return "ok";
  if (run.status === "failed") return "bad";
  return run.status === "paused" || run.status === "cancelled" ? "warn" : "accent";
}

const thousands = (count: number) => count.toLocaleString("en-US");

const counted = (count: number, one: string) =>
  `${thousands(count)} ${one}${count === 1 ? "" : "s"}`;

const stageKey = (stage: RunStage) => stage.name.toLowerCase().replaceAll(" ", "-");

const stageLabels: Record<string, string> = {
  "tiles-read": "Tiles read",
  "tissue-found": "Tissue found",
  "model-running": "Model running",
  "objects-placed": "Objects placed",
  "ids-given": "IDs given",
  "result-set-added": "Result set added",
};

export const stageLabel = (stage: RunStage) => stageLabels[stageKey(stage)] ?? stage.name;

type StepContext = { model: ProjectModel | undefined; resultSet: string };

const untypedReasons: Record<string, string> = {
  "typer-weights-missing": "the typer weights are missing",
};

function typingDetail(stage: RunStage): string | undefined {
  if (stage.untyped_reason) {
    return `cells untyped, ${untypedReasons[stage.untyped_reason] ?? stage.untyped_reason}`;
  }
  return (stage.typed ?? null) === null ? undefined : `${counted(stage.typed ?? 0, "cell")} typed`;
}

function withTyping(detail: string, stage: RunStage): string {
  const typing = typingDetail(stage);
  return typing ? `${detail} · ${typing}` : detail;
}

export function cellsOf(run: ModelRun): number | null {
  const found = run.stages.find((stage) => (stage.objects ?? null) !== null);
  return found?.objects ?? null;
}

function stageDetail(
  stage: RunStage,
  index: number,
  context: StepContext,
  cells: number | null,
  queued: boolean,
): string | undefined {
  if (stage.status === "pending") return undefined;
  const done = stage.status === "done";
  if (index === 0 && queued && stage.units_done > 0 && context.model?.queue_minutes) {
    return `${countWord(stage.units_done)} run ahead, about ${context.model.queue_minutes} min`;
  }
  switch (stageKey(stage)) {
    case "tissue-found":
      return stage.units_total ? counted(stage.units_total, "level") : undefined;
    case "model-running":
      return withTyping(
        done
          ? counted(stage.units_done, "tile")
          : `tile ${thousands(stage.units_done)} of ${thousands(stage.units_total ?? 0)}`,
        stage,
      );
    case "objects-placed":
      return done && cells !== null ? counted(cells, "cell") : undefined;
    case "ids-given":
      return done && cells !== null && cells > 0 ? `C1 to C${cells}` : undefined;
    case "result-set-added":
      return done && stage.finished_at
        ? `${context.resultSet} · ${formatDayMonth(new Date(stage.finished_at))}`
        : undefined;
    default:
      return undefined;
  }
}

export function stepsOf(run: ModelRun, context: StepContext): JobStep[] {
  const cells = cellsOf(run);
  const queued = !run.stages.some(
    (stage) => stageKey(stage) === "model-running" && stage.status !== "pending",
  );
  return run.stages.map((stage, index) => {
    const held = run.status === "paused" && stage.status === "running";
    const current = run.status === "running" && stage.status === "running";
    const state = stageDone(stage) ? "done" : held ? "held" : current ? "current" : "waiting";
    return {
      label: stageLabel(stage),
      detail: stageDetail(stage, index, context, cells, queued),
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
  state: "running" | "paused" | "done" | "failed" | "cancelled";
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
  if (job.status === "failed") {
    return {
      state: "failed",
      percent: job.percent,
      text: `Failed, ${failureText(job.error_code)}`,
    };
  }
  if (job.status === "cancelled") {
    return { state: "cancelled", percent: job.percent, text: "Cancelled" };
  }
  const percent = job.percent;
  if (job.status === "queued") {
    return { state: "running", percent, text: waitText(job) };
  }
  const left = knownMinutes(job.minutes_left);
  if (percent < 5) {
    return {
      state: "running",
      percent,
      text: left === null ? "Starting" : `Starting · about ${left} min`,
    };
  }
  return {
    state: "running",
    percent,
    text: left === null ? `${percent}%` : `${percent}% · about ${left} min left`,
  };
}

export function startedText(job: MyJob, by: string, today: Date): string {
  const at = new Date(job.created_at);
  const days = daysBetween(at, today);
  const when =
    days === 0 ? `started ${formatClock(at)}` : days === 1 ? "yesterday" : formatDayMonth(at);
  return days === 0 ? `${when} by ${by}` : `${when} ${formatClock(at)} by ${by}`;
}

export type RunEstimate = {
  total: number | null;
  doneAround: string | null;
  perSlide: string;
  cost: string | null;
};

function queueAhead(model: ProjectModel): string {
  if (model.runs_ahead === 0 && model.queue_minutes > 0)
    return `Runs from other workspaces are ahead of yours, about ${model.queue_minutes} min.`;
  const runs = model.runs_ahead === 1 ? "One run is" : `${model.runs_ahead} runs are`;
  return `${runs} ahead of yours, about ${model.queue_minutes} min.`;
}

export type SlideSize = { width?: number | null; height?: number | null };

const tileSide = 512;
const referenceTiles = 8000;
const startMinutes = 1.5;

export function slideMinutes(model: ProjectModel, size: SlideSize | undefined): number {
  const typical = model.minutes_per_slide;
  if (!size?.width || !size.height || typical <= startMinutes) return typical;
  const tiles = Math.ceil(size.width / tileSide) * Math.ceil(size.height / tileSide);
  return Math.max(2, Math.ceil(startMinutes + (tiles / referenceTiles) * (typical - startMinutes)));
}

export function runEstimate(
  model: ProjectModel,
  sizes: SlideSize[],
  now: Date,
  estimates?: SlideEstimate[],
): RunEstimate {
  if (model.seconds_per_mm2 != null) {
    return projectedEstimate(model, sizes.length, estimates, now, queueAhead(model));
  }
  const each = sizes.map((size) => slideMinutes(model, size));
  const total = each.reduce((sum, minutes) => sum + minutes, 0);
  const least = each.length ? Math.min(...each) : model.minutes_per_slide;
  const most = each.length ? Math.max(...each) : model.minutes_per_slide;
  const gpuStart = model.host === "lab" ? 0 : model.start_minutes;
  const wait = model.host === "lab" ? 0 : model.queue_minutes + gpuStart;
  const doneAround = formatClock(new Date(now.getTime() + (total + wait) * 60000));
  const range = least === most ? `${least}` : `${least} to ${most}`;
  const start =
    gpuStart > 0 ? ` About ${gpuStart} min of the estimate is waiting for a GPU to start.` : "";
  const perSlide =
    model.serving === "offline"
      ? `${model.server} is not answering right now, so this run cannot start.`
      : model.host === "lab"
        ? `About ${range} min a slide on ${model.server}, which answers now in ${model.latency_ms ?? 0} ms.`
        : `About ${range} min a slide on the ${model.server}. ${queueAhead(model)}${start}`;
  return { total: total + gpuStart, doneAround, perSlide, cost: null };
}

export const makesLabel = { regions: "Regions", cells: "Cells", heatmap: "Heatmap" } as const;

export const isSettled = (summary: RunSummary) =>
  summary.state !== "running" && summary.state !== "paused";

export function gpuText(runs: ModelRun[]): string | null {
  const seconds = runs.reduce((sum, run) => sum + run.gpu_seconds, 0);
  return seconds > 0 ? `${seconds.toFixed(1)} GPU seconds` : null;
}
