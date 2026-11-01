import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario, setFakeViewerScene } from "../src/fake/index.ts";
import {
  getSlideAiProgress,
  getSlideResultStats,
  listAnnotationLayers,
  listModelTiers,
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

test("the outline job has one model for each of Best, Good and Fast", async () => {
  const { data } = await listModelTiers();
  const outline = data.tiers.filter((tier) => tier.job === "outline");
  assert.deepEqual(
    outline.map((tier) => tier.tier),
    ["Best", "Good", "Fast"],
  );
  assert.equal(outline.find((tier) => tier.tier === "Fast")?.runs_on, "browser");
});
