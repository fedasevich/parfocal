import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRun, MyJob, ProjectModel } from "@parfocal/api-client";
import { scenarioJobs } from "@parfocal/api-client/fake";
import { fakeJobsSceneFor } from "../src/fake-api/jobs-scene-rules.ts";
import { fakeViewFor } from "../src/fake-api/view-rules.ts";
import {
  cancellableRuns,
  canOpenSlide,
  finishedTarget,
  gpuText,
  isSettled,
  jobIcon,
  jobTarget,
  knownMinutes,
  pausedRuns,
  runEstimate,
  runSummary,
  slideMinutes,
  slidePercent,
  slideValueText,
  stepsOf,
  trayDetail,
  trayPercent,
  trayTone,
  trayValueText,
} from "../src/screens/jobs/model.ts";
import { startedRunJobId } from "../src/screens/jobs/prototype-scenes.ts";

const today = new Date(2026, 9, 15, 14, 30);

const local = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString();

const job = (patch: Partial<MyJob>): MyJob => ({
  id: "job",
  kind: "model-run",
  title: "PathoSAM + HoVer-NeXt v1.2",
  project: { id: "p07", code: "P07", name: "Sentinel node AI evaluation" },
  status: "running",
  error_code: null,
  detail: "tumor_052 and tumor_060 in P07",
  percent: 3,
  minutes_left: 34,
  units_done: 0,
  units_total: 2,
  unit: "tile",
  started_by_user_id: "dh",
  slides: [],
  pause: null,
  wait: null,
  created_at: "2026-10-15T14:30:00+02:00",
  finished_at: null,
  ...patch,
});

const model = (patch: Partial<ProjectModel>): ProjectModel => ({
  id: "sam",
  name: "pathosam-hovernext",
  version: "v1.2",
  title: "PathoSAM + HoVer-NeXt",
  description: "Every nucleus outlined and typed",
  makes: ["regions", "cells"],
  minutes_per_slide: 17,
  measured: false,
  host: "parfocal",
  server: "Parfocal GPU",
  runs_ahead: 1,
  queue_minutes: 8,
  start_minutes: 0,
  latency_ms: null,
  outputs: [],
  ...patch,
});

const stage = (
  name: string,
  status: "pending" | "running" | "done",
  done = 0,
  total: number | null = null,
) => ({
  name,
  status,
  runs: status === "pending" ? 0 : 1,
  units_done: done,
  units_total: total,
  started_at: null,
  finished_at: status === "done" ? local(14, 16, 36) : null,
});

const run = (status: ModelRun["status"], stages: ModelRun["stages"]): ModelRun => ({
  id: "run",
  batch_id: "job",
  project_id: "p07",
  slide_id: "slide",
  task_id: null,
  status,
  error_code: null,
  pause_reason: null,
  scope: { kind: "slide" },
  parameters: { detector: { name: "camelyon-tumor", version: "v1.0" } },
  result_set_id: null,
  started_by_user_id: "dh",
  attempts: 1,
  created_at: "2026-10-15T08:20:00+02:00",
  finished_at: null,
  gpu_seconds: 0,
  stages,
  actions: [],
});

const pausedRun = run("paused", [
  stage("Queued", "done"),
  stage("Tiles read", "done", 9, 9),
  stage("Tissue found", "done", 48),
  stage("Model running", "running", 448, 1180),
  stage("Objects placed", "pending"),
  stage("IDs given", "pending"),
  stage("Result set added", "pending"),
]);

test("tray rows read like the mock for running, starting, paused and finished jobs", () => {
  assert.equal(trayValueText(job({})), "Starting · 34 min");
  assert.equal(
    trayValueText(job({ kind: "upload", percent: 46, minutes_left: 3 })),
    "46% · 3 min left",
  );
  assert.equal(
    trayValueText(job({ status: "paused", percent: 38, minutes_left: null })),
    "Paused at 38%",
  );
  assert.equal(trayValueText(job({ status: "done", percent: 100 })), "Done");
  const paused = job({
    status: "paused",
    detail: "tumor_044",
    pause: {
      reason: "server-not-answering",
      server: "ml.cuailab.cz",
      since: local(15, 14, 18),
    },
  });
  assert.equal(trayDetail(paused, today), "tumor_044 · the lab server is busy");
  assert.equal(
    trayDetail(job({ status: "done", detail: "12 slides", finished_at: local(15, 9, 12) }), today),
    "12 slides · today 09:12",
  );
  assert.equal(
    trayDetail(
      job({ status: "done", detail: "4 slides in P09", finished_at: local(14, 16, 36) }),
      today,
    ),
    "4 slides in P09 · yesterday",
  );
  assert.equal(trayPercent([job({ percent: 46 }), job({ percent: 38, status: "paused" })]), 42);
});

test("failed and cancelled jobs say so in their own tone and leave the ring", () => {
  const failed = job({
    kind: "upload",
    status: "failed",
    percent: 46,
    finished_at: local(15, 14, 0),
  });
  const cancelled = job({ status: "cancelled", percent: 12, finished_at: local(15, 14, 0) });
  assert.equal(trayValueText(failed), "Failed, no reason was recorded");
  assert.equal(
    trayValueText({ ...failed, error_code: "model-not-served" }),
    "Failed, this model has no worker yet",
  );
  assert.equal(trayTone(failed), "bad");
  assert.equal(trayDetail(failed, today), "tumor_052 and tumor_060 in P07 · today 14:00");
  assert.equal(trayValueText(cancelled), "Cancelled");
  assert.equal(trayTone(cancelled), "warn");
  assert.equal(trayTone(job({ status: "done" })), "ok");
  assert.equal(trayTone(job({ status: "paused" })), "warn");
  assert.equal(trayTone(job({})), "accent");
  assert.equal(trayPercent([failed, cancelled]), 0);
  assert.equal(trayPercent([failed, job({ percent: 30 })]), 30);
});

test("each kind of job has its own icon", () => {
  assert.equal(jobIcon(job({})), "smart");
  assert.equal(jobIcon(job({ kind: "upload" })), "upload");
  assert.equal(jobIcon(job({ kind: "import" })), "link");
});

test("a row opens the job window, the newest upload's page or the project", () => {
  assert.deepEqual(jobTarget(job({}), undefined), { kind: "job", projectId: "p07", jobId: "job" });
  assert.deepEqual(jobTarget(job({ kind: "upload", id: "up" }), "up"), {
    kind: "upload",
    projectId: "p07",
    scene: "progress",
  });
  assert.deepEqual(jobTarget(job({ kind: "upload", id: "old", status: "done" }), "up"), {
    kind: "project",
    projectId: "p07",
  });
  assert.deepEqual(jobTarget(job({ kind: "upload", id: "up", status: "done" }), "up"), {
    kind: "job",
    projectId: "p07",
    jobId: "up",
  });
});

test("a finished job opens its one slide, its job window or its project", () => {
  const slide = { id: "s1", label: "tumor_052", file: "tumor_052.svs" };
  const other = { id: "s2", label: "tumor_060", file: "tumor_060.svs" };
  assert.deepEqual(finishedTarget(job({ status: "done", slides: [slide] })), {
    kind: "slide",
    projectId: "p07",
    slideId: "s1",
  });
  assert.deepEqual(finishedTarget(job({ status: "done", slides: [slide, other] })), {
    kind: "job",
    projectId: "p07",
    jobId: "job",
  });
  assert.deepEqual(
    finishedTarget(job({ kind: "upload", status: "done", slides: [slide, other] })),
    {
      kind: "project",
      projectId: "p07",
    },
  );
});

test("the estimate adds the queue on the Parfocal GPU and none on the lab server", () => {
  const gpu = runEstimate(model({}), [{}, {}], today);
  assert.equal(gpu.total, 34);
  assert.equal(gpu.doneAround, "15:12");
  assert.equal(
    gpu.perSlide,
    "About 17 min a slide on the Parfocal GPU. One run is ahead of yours, about 8 min.",
  );
  const lab = runEstimate(
    model({ minutes_per_slide: 6, host: "lab", server: "ml.cuailab.cz", latency_ms: 210 }),
    [{}, {}],
    today,
  );
  assert.equal(lab.doneAround, "14:42");
  assert.equal(lab.perSlide, "About 6 min a slide on ml.cuailab.cz, which answers now in 210 ms.");
  const shared = runEstimate(model({ runs_ahead: 0, queue_minutes: 13 }), [{}], today);
  assert.equal(
    shared.perSlide,
    "About 17 min a slide on the Parfocal GPU. Runs from other workspaces are ahead of yours, about 13 min.",
  );
});

test("the estimate adds the measured GPU start and names it", () => {
  const cold = runEstimate(model({ start_minutes: 3 }), [{ width: 2220, height: 2967 }], today);
  assert.equal(cold.total, 5);
  assert.equal(cold.doneAround, "14:43");
  assert.equal(
    cold.perSlide,
    "About 2 min a slide on the Parfocal GPU. One run is ahead of yours, about 8 min. About 3 min of the estimate is waiting for a GPU to start.",
  );
  const lab = runEstimate(model({ start_minutes: 3, host: "lab", latency_ms: 210 }), [{}], today);
  assert.equal(lab.total, 17);
});

test("a queued run says why it waits", () => {
  const since = local(15, 14, 9);
  const waiting = (reason: "waiting-for-gpu" | "gpu-busy" | "woken-again") =>
    job({ status: "queued", percent: 0, minutes_left: null, wait: { reason, since } });
  assert.equal(trayValueText(waiting("waiting-for-gpu")), "Waiting for a GPU");
  assert.equal(runSummary(waiting("gpu-busy")).text, "Waiting, the GPU is busy");
  assert.equal(trayValueText(waiting("woken-again")), "Starting the GPU again");
  assert.equal(
    trayDetail(waiting("waiting-for-gpu"), today),
    "tumor_052 and tumor_060 in P07 · queued since 14:09",
  );
  const plain = job({ status: "queued", percent: 0 });
  assert.equal(trayValueText(plain), "Waiting to start");
  assert.equal(trayDetail(plain, today), "tumor_052 and tumor_060 in P07");
});

test("the estimate fits the slide, about two minutes for a small one and an hour for a huge one", () => {
  const small = runEstimate(model({}), [{ width: 2220, height: 2967 }], today);
  assert.equal(small.total, 2);
  assert.equal(
    small.perSlide,
    "About 2 min a slide on the Parfocal GPU. One run is ahead of yours, about 8 min.",
  );
  const large = runEstimate(model({}), [{ width: 100000, height: 80000 }], today);
  assert.equal(large.total, 62);
  const mixed = runEstimate(
    model({}),
    [
      { width: 2220, height: 2967 },
      { width: 100000, height: 80000 },
    ],
    today,
  );
  assert.equal(mixed.total, 64);
  assert.match(mixed.perSlide, /^About 2 to 62 min a slide/);
  assert.equal(slideMinutes(model({}), undefined), 17);
  assert.equal(slideMinutes(model({}), { width: null, height: null }), 17);
  assert.equal(slideMinutes(model({ minutes_per_slide: 1 }), { width: 2220, height: 2967 }), 1);
});

test("a paused slide holds at the model step with tile 448 of 1,180", () => {
  assert.equal(slidePercent(pausedRun), 38);
  assert.equal(slideValueText(pausedRun), "Paused");
  const steps = stepsOf(pausedRun, { model: undefined, resultSet: "CAMELYON tumor model v1.0" });
  assert.deepEqual(
    steps.map((step) => `${step.state} ${step.detail ?? ""}`.trim()),
    ["done", "done", "done", "held tile 448 of 1,180", "waiting", "waiting", "waiting"],
  );
});

const rawStage = (
  name: string,
  status: "pending" | "running" | "done",
  done: number,
  total: number | null,
  objects?: number,
) => ({ ...stage(name, status, done, total), ...(objects === undefined ? {} : { objects }) });

test("a finished run names its steps in words with its tiles, cells and IDs", () => {
  const done = run("done", [
    rawStage("tiles-read", "done", 11, 11),
    rawStage("tissue-found", "done", 1, 1),
    rawStage("model-running", "done", 11, 11, 2428),
    rawStage("objects-placed", "done", 11, 11),
    rawStage("ids-given", "done", 1, 1),
    rawStage("result-set-added", "done", 1, 1),
  ]);
  const steps = stepsOf(done, { model: model({ queue_minutes: 0 }), resultSet: "HoVer-Net v2.1" });
  assert.deepEqual(
    steps.map((step) => step.label),
    [
      "Tiles read",
      "Tissue found",
      "Model running",
      "Objects placed",
      "IDs given",
      "Result set added",
    ],
  );
  assert.deepEqual(
    steps.map((step) => step.detail ?? ""),
    ["", "1 level", "11 tiles", "2,428 cells", "C1 to C2428", "HoVer-Net v2.1 · 14 Oct"],
  );
  assert.equal(slidePercent(done), 100);
});

test("a run that is waiting says how long the runs ahead take, and a running one says its tile", () => {
  const waiting = run("running", [
    rawStage("tiles-read", "running", 1, 3),
    rawStage("tissue-found", "pending", 0, null),
    rawStage("model-running", "pending", 0, null),
  ]);
  assert.equal(
    stepsOf(waiting, { model: model({ queue_minutes: 8 }), resultSet: "" })[0]?.detail,
    "one run ahead, about 8 min",
  );
  assert.equal(
    stepsOf(waiting, { model: model({ queue_minutes: 0 }), resultSet: "" })[0]?.detail,
    undefined,
  );
  const running = run("running", [
    rawStage("tiles-read", "done", 11, 11),
    rawStage("tissue-found", "done", 1, 1),
    rawStage("model-running", "running", 4, 11),
  ]);
  assert.equal(stepsOf(running, { model: undefined, resultSet: "" })[2]?.detail, "tile 4 of 11");
});

test("the model step says how many cells the typer typed, or why the cells stay untyped", () => {
  const typing = run("running", [
    rawStage("tiles-read", "done", 11, 11),
    rawStage("tissue-found", "done", 1, 1),
    { ...rawStage("model-running", "running", 4, 11, 900), typed: 900 },
  ]);
  assert.equal(
    stepsOf(typing, { model: undefined, resultSet: "" })[2]?.detail,
    "tile 4 of 11 · 900 cells typed",
  );
  const typed = run("done", [
    rawStage("tiles-read", "done", 11, 11),
    rawStage("tissue-found", "done", 1, 1),
    { ...rawStage("model-running", "done", 11, 11, 2428), typed: 2428 },
  ]);
  assert.equal(
    stepsOf(typed, { model: undefined, resultSet: "" })[2]?.detail,
    "11 tiles · 2,428 cells typed",
  );
  const untyped = run("done", [
    rawStage("tiles-read", "done", 11, 11),
    rawStage("tissue-found", "done", 1, 1),
    {
      ...rawStage("model-running", "done", 11, 11, 2428),
      untyped_reason: "typer-weights-missing",
    },
  ]);
  assert.equal(
    stepsOf(untyped, { model: undefined, resultSet: "" })[2]?.detail,
    "11 tiles · cells untyped, the typer weights are missing",
  );
});

test("a job with no minutes left says no minutes at all", () => {
  assert.equal(knownMinutes(0), null);
  assert.equal(knownMinutes(null), null);
  assert.equal(knownMinutes(undefined), null);
  assert.equal(knownMinutes(3), 3);
  assert.equal(runSummary(job({ percent: 40, minutes_left: 0 })).text, "40%");
  assert.equal(runSummary(job({ minutes_left: null })).text, "Starting");
  assert.equal(runSummary(job({ percent: 40, minutes_left: 12 })).text, "40% · about 12 min left");
  assert.equal(trayValueText(job({ percent: 40, minutes_left: 0 })), "40%");
});

test("the whole run reads starting, paused or done in its minutes", () => {
  assert.equal(runSummary(job({})).text, "Starting · about 34 min");
  assert.equal(runSummary(job({ status: "paused", percent: 38 })).text, "Paused at 38%");
  assert.equal(runSummary(job({ status: "queued" })).text, "Waiting to start");
  assert.equal(trayValueText(job({ status: "queued" })), "Waiting to start");
  const failed = runSummary(job({ status: "failed", error_code: "too-many-claims" }));
  assert.deepEqual(
    [failed.state, failed.text],
    ["failed", "Failed, the worker stopped three times"],
  );
  assert.equal(isSettled(failed), true);
  assert.equal(isSettled(runSummary(job({}))), false);
  assert.equal(runSummary(job({ status: "cancelled" })).text, "Cancelled");
  assert.equal(
    runSummary(
      job({
        status: "done",
        created_at: "2026-10-14T16:02:00+02:00",
        finished_at: "2026-10-14T16:36:00+02:00",
      }),
    ).text,
    "Done in 34 min",
  );
});

test("the job scenes follow the route and Daniel views them", () => {
  assert.equal(fakeJobsSceneFor("/projects/p07/run-model", { scene: "pick" }), "before-run");
  assert.equal(fakeJobsSceneFor("/projects/p07/run-model", { scene: "started" }), "run-started");
  assert.equal(fakeJobsSceneFor(`/projects/p07/jobs/${startedRunJobId}`, {}), "run-started");
  assert.equal(fakeJobsSceneFor("/projects/p07/jobs/other", {}), null);
  assert.equal(fakeJobsSceneFor("/projects/p07", {}), null);
  assert.equal(startedRunJobId, scenarioJobs.startedRunId);
  assert.equal(fakeViewFor("/projects/p07/run-model", {}).viewer, "DH");
  assert.equal(fakeViewFor(`/projects/p07/jobs/${startedRunJobId}`, {}).viewer, "DH");
});

test("a slide opens once its objects are placed and not before", () => {
  const placing = run("running", [
    stage("Queued", "done"),
    stage("Tiles read", "done", 9, 9),
    stage("Tissue found", "done", 61),
    stage("Model running", "done", 1, 1),
    stage("Objects placed", "running", 400, 21408),
    stage("IDs given", "pending"),
    stage("Result set added", "pending"),
  ]);
  assert.equal(canOpenSlide(pausedRun), false);
  assert.equal(canOpenSlide(placing), true);
  assert.equal(slideValueText(placing), "Objects placed");
});

test("cancel stops every slide that is not finished and leaves the finished ones", () => {
  const finished = { ...run("done", []), id: "finished", actions: [] };
  const running = { ...run("running", []), id: "running", actions: ["cancel" as const] };
  const waiting = { ...run("queued", []), id: "waiting", actions: ["cancel" as const] };
  const paused = { ...pausedRun, id: "paused", actions: ["resume" as const, "cancel" as const] };
  const runs = [finished, running, waiting, paused];
  assert.deepEqual(
    cancellableRuns(runs).map((item) => item.id),
    ["running", "waiting", "paused"],
  );
  assert.deepEqual(
    pausedRuns(runs).map((item) => item.id),
    ["paused"],
  );
});

test("a finished run names the GPU seconds its slides used and a failed slide says so", () => {
  const done = { ...run("done", []), gpu_seconds: 40.2 };
  assert.equal(gpuText([done, { ...done, gpu_seconds: 18.4 }]), "58.6 GPU seconds");
  assert.equal(gpuText([run("done", [])]), null);
  assert.equal(slideValueText(run("failed", [])), "Failed");
});
