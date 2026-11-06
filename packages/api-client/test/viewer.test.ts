import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  fakeApiHandlers,
  scenario,
  setFakeAiStreaming,
  setFakeViewerScene,
} from "../src/fake/index.ts";
import {
  getResultSetTyper,
  getSlideAiProgress,
  getSlideResultStats,
  listAnnotationLayers,
  listModelTiers,
  typeOutlines,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => {
  setFakeViewerScene("ready");
});

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const rt14 = scenario.reviewTasks.find((item) => item.code === "RT-14");
const a1 = scenario.slideByIndex(1);

test("A1's cell classes add up to the 18,240 cells the AI found", async () => {
  assert.ok(rt14);
  const { data } = await getSlideResultStats(rt14.id, a1.id);
  assert.equal(
    data.class_counts.reduce((sum, row) => sum + row.count, 0),
    18240,
  );
  assert.equal(data.score_bins.length, 10);
});

test("every region of A1 and the added one has a place in each comparison", async () => {
  assert.ok(rt14);
  const { data } = await getSlideResultStats(rt14.id, a1.id);
  const ids = ["T1", "T2", "T3", "T4", "T5", "T6⁺"];
  assert.deepEqual(
    data.ai_vs_reviewed.objects.map((row) => row.object),
    ids,
  );
  assert.deepEqual(
    data.reviewers.objects.map((row) => row.object),
    ids,
  );
  assert.equal(
    data.ai_vs_reviewed.objects.find((row) => row.object === "T6⁺")?.agreement,
    "reviewer_only",
  );
  assert.equal(data.reviewers.user_ids.length, 2);
  assert.deepEqual(data.model_vs_model.only_in_a, ["T5"]);
});

test("a slide outside the review has no comparisons", async () => {
  assert.ok(rt14);
  const { data } = await getSlideResultStats(rt14.id, scenario.slideByIndex(4).id);
  assert.deepEqual(data.class_counts, []);
  assert.equal(data.reviewers.kappa, null);
});

test("the AI is still reading only in the running scene", async () => {
  assert.equal((await getSlideAiProgress(a1.id)).data.state, "ready");
  setFakeViewerScene("running");
  const { data } = await getSlideAiProgress(a1.id);
  assert.equal(data.state, "running");
  assert.deepEqual(data.found, ["T1", "T2"]);
  assert.deepEqual(
    data.steps.map((step) => step.state),
    ["done", "running", "queued"],
  );
});

test("a streaming running scene finds one more region on every later read and starts over with the scene", async () => {
  setFakeAiStreaming(true);
  setFakeViewerScene("ready");
  setFakeViewerScene("running");
  const reads = [];
  for (let read = 0; read < 5; read += 1) reads.push((await getSlideAiProgress(a1.id)).data.found);
  assert.deepEqual(reads, [
    ["T1", "T2"],
    ["T1", "T2", "T3"],
    ["T1", "T2", "T3", "T4"],
    ["T1", "T2", "T3", "T4", "T5"],
    ["T1", "T2", "T3", "T4", "T5"],
  ]);
  setFakeViewerScene("ready");
  setFakeViewerScene("running");
  assert.deepEqual((await getSlideAiProgress(a1.id)).data.found, ["T1", "T2"]);
  setFakeAiStreaming(false);
  await getSlideAiProgress(a1.id);
  assert.deepEqual((await getSlideAiProgress(a1.id)).data.found, ["T1", "T2"]);
});

test("a streaming running scene moves the regions step forward and stops short of done", async () => {
  setFakeAiStreaming(true);
  setFakeViewerScene("ready");
  setFakeViewerScene("running");
  const percents = [];
  for (let read = 0; read < 7; read += 1) {
    const { steps } = (await getSlideAiProgress(a1.id)).data;
    percents.push(steps.find((step) => step.key === "regions")?.percent);
  }
  assert.deepEqual(percents, [55, 65, 75, 85, 95, 95, 95]);
  setFakeAiStreaming(false);
});

test("the annotate workspace's layers on A1 add the two child layers up to their parent", async () => {
  const { data } = await listAnnotationLayers(a1.id);
  const parent = data.layers.find((layer) => layer.key === data.new_shapes_go_to);
  assert.ok(parent);
  const children = data.layers.filter((layer) => layer.parent === parent.key);
  assert.equal(
    children.reduce((sum, layer) => sum + layer.count, 0),
    parent.count,
  );
  assert.deepEqual((await listAnnotationLayers(scenario.slideByIndex(2).id)).data.layers, []);
});

test("the outline task has Best and Good mapped and Fast left to the lab", async () => {
  const { data } = await listModelTiers();
  assert.ok(Array.isArray(data));
  const outline = data.filter((mapping) => mapping.task === "outline");
  assert.deepEqual(
    outline.map((mapping) => [mapping.tier, mapping.model?.label ?? null]),
    [
      ["best", "PathoSAM + HoVer-NeXt · v1.2"],
      ["good", "HoVer-Net · v0.9"],
      ["fast", null],
    ],
  );
});

test("the fake typers carry the calibration evidence the Word wording needs", async () => {
  for (const key of ["cam", "sam"]) {
    const set = scenario.resultSets.find((item) => item.key === key);
    assert.ok(set);
    const { data } = await getResultSetTyper(set.id);
    assert.equal(data.calibrated, true);
    assert.equal(data.checked_on_held_out, true);
    assert.ok(data.band_accuracy.confident !== undefined);
  }
});

test("PathoSAM's typer scores under the accuracy floor and CAMELYON's does not", async () => {
  const accuracy = async (key: string) => {
    const set = scenario.resultSets.find((item) => item.key === key);
    assert.ok(set);
    return (await getResultSetTyper(set.id)).data.test_set_accuracy ?? 1;
  };
  assert.ok((await accuracy("sam")) < 0.7);
  assert.ok((await accuracy("cam")) >= 0.7);
});

test("the fake server typer returns one calibrated HoVer-NeXt type per outline", async () => {
  const square = (x: number) => [x - 8, 8, x + 8, 8, x + 8, 24, x - 8, 24];
  const { data } = await typeOutlines(a1.id, {
    outlines: [{ points: square(16) }, { points: square(112) }],
  });
  assert.equal(data.typer, "pathosam-hovernext");
  assert.equal(data.calibrated, true);
  assert.deepEqual(
    data.outlines.map((outline) => outline.type),
    ["tumor", "other"],
  );
  for (const outline of data.outlines) {
    const sum = Object.values(outline.probabilities).reduce((total, share) => total + share, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  }
  await assert.rejects(typeOutlines(a1.id, { outlines: [] }));
});
