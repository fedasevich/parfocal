import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeQueueScene,
  fakeApiHandlers,
  resetQueueState,
  scenario,
  setFakeQueueScene,
} from "../src/fake/index.ts";
import {
  decideAdjudication,
  getDisagreementQueue,
  getEvaluationReport,
  getMyAdjudication,
  getReviewTaskStates,
  getSignOffSummary,
  getTaskEvaluation,
  sendToAdjudicator,
  signOffReviewTask,
  startEvaluationVersion,
  updateQueuedObject,
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
  setFakeQueueScene(defaultFakeQueueScene);
  resetQueueState();
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const { people, reviewTasks } = scenario;
const rt14 = reviewTasks.find((task) => task.code === "RT-14")?.id ?? "";
const open = { ...defaultFakeQueueScene, stage: "open" as const };

const summaryOf = async (taskId: string) => {
  const response = await getSignOffSummary(taskId);
  assert.ok(response.status === 200);
  return response.data;
};

test("the queue holds the mock's seven objects with five where reviewers differ", async () => {
  setFakeQueueScene(open);
  const queue = (await getDisagreementQueue(rt14)).data;
  assert.equal(queue.locked, null);
  assert.deepEqual(
    queue.rows.map((row) => `${row.slide_label}:${row.object}`),
    ["A1:T2", "A1:T4", "A1:T5", "A1:T1·C212", "A1:T1·C145", "tumor_031:T1", "tumor_044:T2·C88"],
  );
  assert.equal(queue.rows.filter((row) => row.tag !== "bothai").length, 5);
  assert.equal(queue.rows.find((row) => row.object === "T4")?.tag, "second");
});

test("the queue is locked until Simona submits her last 8 slides", async () => {
  const queue = (await getDisagreementQueue(rt14)).data;
  assert.deepEqual(queue.locked, { user_id: people.SM.id, slides_left: 8 });
  const summary = await summaryOf(rt14);
  assert.equal(summary.reviews.total - summary.reviews.submitted, 13);
  assert.equal(summary.queue.resolved, 0);
});

test("objects sent to Anna reach her anonymously and her decisions resolve them", async () => {
  setFakeQueueScene(open);
  const queue = (await getDisagreementQueue(rt14)).data;
  const picked = queue.rows.filter((row) => ["T4", "T5", "T1·C145"].includes(row.object));
  await sendToAdjudicator(rt14, {
    adjudicator_user_id: people.AK.id,
    note: null,
    objects: picked.map((row) => ({ slide_id: row.slide_id, object: row.object })),
  });
  const mine = (await getMyAdjudication(rt14)).data;
  assert.equal(mine.objects.length, 3);
  assert.equal(mine.asked_by_user_id, people.DH.id);
  assert.ok(!JSON.stringify(mine).includes(people.LM.id));
  const [first] = mine.objects;
  assert.ok(first);
  assert.equal(first.reviewer_a.reason, "Not tumor");
  await decideAdjudication({
    taskId: rt14,
    slideId: first.slide_id,
    object: first.object,
    data: { raw: "disagree" },
  });
  const summary = await summaryOf(rt14);
  assert.deepEqual(summary.queue.by_adjudicator, [{ user_id: people.AK.id, count: 1 }]);
  assert.deepEqual(summary.queue.with_adjudicator, [{ user_id: people.AK.id, count: 2 }]);
});

test("deciding and leaving open count as resolved, and signing freezes the task", async () => {
  setFakeQueueScene({ ...defaultFakeQueueScene, stage: "resolved" });
  const summary = await summaryOf(rt14);
  assert.equal(summary.queue.resolved, 7);
  assert.equal(summary.queue.by_researcher, 2);
  assert.deepEqual(
    summary.queue.left_open.map((row) => `${row.object} on ${row.slide_label}`),
    ["T1·C212 on A1", "T1 on tumor_031"],
  );
  const states = await signOffReviewTask(rt14);
  assert.ok(states.status === 200 && states.data.signed_off_at);
  const after = await getReviewTaskStates(rt14);
  assert.ok(after.status === 200 && after.data.signed_off_at);
  const signed = await summaryOf(rt14);
  assert.equal(signed.signature?.checksum, "sha256:8c1f…a90e");
  await startEvaluationVersion(rt14, { reason: "Measured again on deeper levels" });
  assert.equal((await summaryOf(rt14)).next_version?.version, 2);
});

test("a decision in the queue is stored next to both reviewers", async () => {
  setFakeQueueScene(open);
  const queue = (await getDisagreementQueue(rt14)).data;
  const t2 = queue.rows[0];
  assert.ok(t2);
  const row = (
    await updateQueuedObject({
      taskId: rt14,
      slideId: t2.slide_id,
      object: t2.object,
      data: { action: "decide", raw: "disagree", note: "Past the fold" },
    })
  ).data;
  assert.equal(row.state, "decided");
  assert.equal(row.decision?.by_user_id, people.DH.id);
  assert.equal(row.answers.length, 2);
});

test("the evaluation carries the mock's headline numbers and the retired template", async () => {
  setFakeQueueScene({ ...defaultFakeQueueScene, stage: "resolved", signed: true, retired: true });
  const evaluation = await getTaskEvaluation(rt14);
  assert.ok(evaluation.status === 200);
  assert.equal(evaluation.data.overall[0]?.sensitivity.value, 0.92);
  assert.equal(evaluation.data.mean_kappa, 0.71);
  const report = (await getEvaluationReport(rt14)).data;
  assert.equal(report.template.retired_on, "2026-10-14");
  assert.equal(report.confusion.counts[0]?.[0], 412);
  assert.equal(report.changes.length, 1);
});
