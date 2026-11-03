import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRun, MyJob, ProjectModel } from "@parfocal/api-client";
import { scenarioJobs } from "@parfocal/api-client/fake";
import { fakeJobsSceneFor } from "../src/fake-api/jobs-scene-rules.ts";
import { fakeViewFor } from "../src/fake-api/view-rules.ts";
import {
  jobIcon,
  jobTarget,
  runEstimate,
  runSummary,
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
  detail: "tumor_052 and tumor_060 in P07",
  percent: 3,
  minutes_left: 34,
  units_done: 0,
  units_total: 2,
  started_by_user_id: "dh",
  slides: [],
  pause: null,
  created_at: "2026-10-15T14:30:00+02:00",
  finished_at: null,
  ...patch,
});

const model = (patch: Partial<ProjectModel>): ProjectModel => ({
  id: "sam",
  name: "pathosam-hovernext",
  version: "v1.2",
  title: "PathoSAM + HoVer-NeXt",
  description: "Tumor regions and every cell with a type",
  makes: ["regions", "cells"],
  minutes_per_slide: 17,
  measured: false,
  host: "parfocal",
  server: "Parfocal GPU",
  runs_ahead: 1,
  queue_minutes: 8,
  latency_ms: null,
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
  assert.equal(trayValueText(failed), "Failed");
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
});

test("the estimate adds the queue on the Parfocal GPU and none on the lab server", () => {
  const gpu = runEstimate(model({}), 2, today);
  assert.equal(gpu.total, 34);
  assert.equal(gpu.doneAround, "15:12");
  assert.equal(
    gpu.perSlide,
    "About 17 min a slide on the Parfocal GPU. One run is ahead of yours, about 8 min.",
  );
  const lab = runEstimate(
    model({ minutes_per_slide: 6, host: "lab", server: "ml.cuailab.cz", latency_ms: 210 }),
    2,
    today,
  );
  assert.equal(lab.doneAround, "14:42");
  assert.equal(lab.perSlide, "About 6 min a slide on ml.cuailab.cz, which answers now in 210 ms.");
});

test("a paused slide holds at the model step with tile 448 of 1,180", () => {
  assert.equal(slidePercent(pausedRun), 38);
  assert.equal(slideValueText(pausedRun), "Paused");
  const steps = stepsOf(pausedRun, { model: undefined, resultSet: "CAMELYON tumor model v1.0" });
  assert.deepEqual(
    steps.map((step) => `${step.state} ${step.detail ?? ""}`.trim()),
    [
      "done",
      "done 9 levels",
      "done 48 mm²",
      "held tile 448 of 1,180",
      "waiting",
      "waiting",
      "waiting",
    ],
  );
});

test("a finished slide names its cells, its IDs and the result set", () => {
  const done = run("done", [
    stage("Queued", "done"),
    stage("Tiles read", "done", 9, 9),
    stage("Tissue found", "done", 61),
    stage("Model running", "done", 1, 1),
    stage("Objects placed", "done", 21408, 21408),
    stage("IDs given", "done", 21408, 21408),
    stage("Result set added", "done", 1, 1),
  ]);
  const details = stepsOf(done, { model: undefined, resultSet: "HoVer-Net v2.1" }).map(
    (step) => step.detail ?? "",
  );
  assert.deepEqual(details, [
    "",
    "9 levels",
    "61 mm²",
    "all tiles",
    "21,408 cells",
    "C1 to C21408",
    "HoVer-Net v2.1 · 14 Oct",
  ]);
  assert.equal(slidePercent(done), 100);
});

test("the whole run reads starting, paused or done in its minutes", () => {
  assert.equal(runSummary(job({})).text, "Starting · about 34 min");
  assert.equal(runSummary(job({ status: "paused", percent: 38 })).text, "Paused at 38%");
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
