import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  fakeApiHandlers,
  resetJobsState,
  scenario,
  scenarioJobs,
  setFakeJobsScene,
} from "../src/fake/index.ts";
import {
  cancelModelRun,
  getModelRunDefaults,
  listModelRuns,
  listMyJobs,
  listProjectModels,
  moveModelRun,
  resumeModelRun,
  startModelRuns,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetJobsState());

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const p07 = scenario.projectByCode("P07").id;

const runsOf = async (batchId: string) => {
  const response = await listModelRuns(p07, { batch_id: batchId });
  assert.equal(response.status, 200);
  return response.status === 200 ? response.data : [];
};

const trayRows = async () =>
  (await listMyJobs()).data.map((job) => `${job.title} ${job.status} ${job.percent}`);

test("the tray before a run shows the upload and the paused CAMELYON run", async () => {
  assert.deepEqual(await trayRows(), [
    "Upload into P07 running 46",
    "CAMELYON tumor model v1.0 paused 38",
    "Upload into P09 done 100",
    "HoVer-Net v2.1 done 100",
  ]);
  const paused = (await listMyJobs()).data[1];
  assert.equal(paused?.pause?.server, "ml.cuailab.cz");
  assert.deepEqual(
    paused?.slides.map((slide) => slide.file),
    ["tumor_044.tif"],
  );
});

test("the defaults pick tumor_052 and tumor_060 with PathoSAM", async () => {
  const defaults = (await getModelRunDefaults(p07)).data;
  const listed = await listProjectModels(p07);
  assert.ok(listed.status === 200);
  const models = listed.data;
  assert.equal(
    models.find((model) => model.id === defaults.model_id)?.title,
    "PathoSAM + HoVer-NeXt",
  );
  assert.deepEqual(
    defaults.slide_ids.map((id) => scenarioJobs.toSlideRef(id)?.label),
    ["tumor_052", "tumor_060"],
  );
  assert.deepEqual(
    models.map((model) => `${model.host} ${model.minutes_per_slide}`),
    ["parfocal 4", "parfocal 17", "parfocal 9", "lab 6"],
  );
});

test("starting a run adds it to the tray with one run per slide", async () => {
  const defaults = (await getModelRunDefaults(p07)).data;
  const started = await startModelRuns(p07, {
    slide_ids: defaults.slide_ids,
    scope: { kind: "slide" },
    parameters: { detector: { name: "pathosam-hovernext", version: "v1.2" } },
  });
  assert.equal(started.status, 201);
  assert.deepEqual(await trayRows(), [
    "PathoSAM + HoVer-NeXt v1.2 running 3",
    "Upload into P07 done 100",
    "CAMELYON tumor model v1.0 paused 38",
    "Upload into P09 done 100",
    "HoVer-Net v2.1 done 100",
  ]);
  const runs = await runsOf(scenarioJobs.startedRunId);
  assert.deepEqual(
    runs.map(
      (run) => `${run.status} ${run.stages.filter((stage) => stage.status === "done").length}`,
    ),
    ["running 1", "queued 0"],
  );
  assert.equal((await listMyJobs()).data[0]?.detail, "tumor_052 and tumor_060 in P07");
});

test("the run-started scene seeds the same run without a click", async () => {
  assert.equal(setFakeJobsScene("run-started"), true);
  assert.equal(setFakeJobsScene("run-started"), false);
  assert.equal((await runsOf(scenarioJobs.startedRunId)).length, 2);
  assert.equal(setFakeJobsScene("before-run"), true);
  assert.equal((await runsOf(scenarioJobs.startedRunId)).length, 0);
});

test("the paused run sits at tile 448 of 1,180 and resumes from there", async () => {
  const [run] = await runsOf(scenarioJobs.pausedRun.id);
  assert.equal(run?.status, "paused");
  assert.deepEqual(run?.actions, ["resume", "cancel"]);
  const running = run?.stages.find((stage) => stage.status === "running");
  assert.deepEqual(
    [running?.name, running?.units_done, running?.units_total],
    ["Model running", 448, 1180],
  );
  assert.equal(scenarioJobs.stepPercent([448, 1180]), 38);
  await resumeModelRun(p07, run?.id ?? "");
  const [resumed] = await runsOf(scenarioJobs.pausedRun.id);
  assert.equal(resumed?.status, "running");
  assert.equal((await listMyJobs()).data[1]?.minutes_left, 6);
});

test("moving the paused run to the Parfocal GPU shortens what is left", async () => {
  const [run] = await runsOf(scenarioJobs.pausedRun.id);
  await moveModelRun(p07, run?.id ?? "", { server: "Parfocal GPU" });
  const job = (await listMyJobs()).data[1];
  assert.equal(job?.status, "running");
  assert.equal(job?.minutes_left, 4);
});

test("a cancelled run leaves the tray and resume brings it back", async () => {
  const [run] = await runsOf(scenarioJobs.pausedRun.id);
  const cancelled = await cancelModelRun(p07, run?.id ?? "");
  assert.equal(cancelled.status === 200 ? cancelled.data.status : null, "cancelled");
  assert.equal((await trayRows()).length, 3);
  await resumeModelRun(p07, run?.id ?? "");
  assert.equal((await trayRows())[1], "CAMELYON tumor model v1.0 paused 38");
});

test("the finished run has every step done on four slides", async () => {
  const p09 = scenario.projectByCode("P09").id;
  const response = await listModelRuns(p09, { batch_id: scenarioJobs.finishedRunId });
  const runs = response.status === 200 ? response.data : [];
  assert.equal(runs.length, 4);
  for (const run of runs) assert.ok(run.stages.every((stage) => stage.status === "done"));
  assert.deepEqual(
    runs.map((run) => run.stages[4]?.units_done),
    [21408, 15330, 18902, 12775],
  );
});
