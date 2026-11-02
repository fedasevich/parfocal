import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeView,
  fakeApiHandlers,
  scenario,
  scenarioReview,
  scenarioTask,
  setFakeView,
} from "../src/fake/index.ts";
import {
  getDecisionStyle,
  getOpinion,
  getReviewOrder,
  getReviewTask,
  getSlideAgreement,
  getSlideNeighbours,
  getTaskDisplay,
  listReviewObjects,
  listSlideThreads,
  listThreadComments,
  listVerdicts,
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
  setFakeView(defaultFakeView);
});

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

function body<Response extends { status: number; data: unknown }>(
  response: Response,
): Extract<Response, { status: 200 }>["data"] {
  assert.equal(response.status, 200);
  return (response as Extract<Response, { status: 200 }>).data;
}

const rt14 = scenario.reviewTasks.find((item) => item.code === "RT-14");
const a1 = scenario.slideByIndex(1);

test("RT-14 on A1 has the mock's five regions and 50 sampled cells in order", async () => {
  assert.ok(rt14);
  const order = body(await getReviewOrder(rt14.id, a1.id));
  assert.equal(order.total, 55);
  assert.deepEqual(
    order.objects.slice(0, 6).map((item) => item.object),
    ["T1", "T2", "T3", "T4", "T5", "T1·C101"],
  );
  const objects = (await listReviewObjects(rt14.id, a1.id)).data.objects;
  assert.deepEqual(
    objects.map((item) => item.object),
    order.objects.map((item) => item.object),
  );
  const t5 = objects.find((item) => item.object === "T5");
  assert.equal(t5?.score, 0.52);
  assert.equal(t5?.size_mm, 0.4);
  const cell = objects.find((item) => item.object === "T2·C204");
  assert.equal(cell?.score, 0.54);
  assert.equal(cell?.other_class, "Immune");
});

test("the verdicts on A1 add up to the counts Home, My work and the ring read", async () => {
  assert.ok(rt14);
  const counts = scenario.slideDecisions.find((item) => item.task === "RT-14" && item.slide === 1);
  assert.ok(counts);
  const verdicts = body(await listVerdicts(rt14.id, a1.id));
  const count = (value: string) => verdicts.filter((verdict) => verdict.value === value).length;
  assert.equal(count("agree"), counts.agree);
  assert.equal(count("disagree"), counts.disagree);
  assert.equal(count("unsure"), counts.unsure);
  const open = scenarioReview.openInReview;
  assert.equal(counts.total - verdicts.length, open.length);
  assert.ok(open.every((object) => !verdicts.some((verdict) => verdict.object === object)));
  const t2 = verdicts.find((verdict) => verdict.object === "T2");
  assert.deepEqual(t2?.reasons, ["boundary_off"]);
  assert.match(t2?.note ?? "", /@Daniel Hruška/);
});

test("finishing A1 the way the scenario does gives 48 agree, 5 disagree and 2 not sure", () => {
  const final = scenarioReview.reviewObjects.map((item) =>
    scenarioReview.lenkaFinalDecision(item.object),
  );
  const count = (value: string) => final.filter((decision) => decision.value === value).length;
  assert.deepEqual([count("agree"), count("disagree"), count("unsure")], [48, 5, 2]);
});

test("RT-14 asks Agree with the AI and RT-16 asks 5-point certainty", async () => {
  assert.ok(rt14);
  assert.equal((await getDecisionStyle(rt14.id)).data.kind, "agree");
  const rt16 = scenarioReview.rt16;
  assert.equal(body(await getReviewTask(rt16.id)).name, "Round 3 · CAMELYON v1.0");
  const style = (await getDecisionStyle(rt16.id)).data;
  assert.equal(style.kind, "certainty");
  assert.deepEqual([style.agree_from, style.disagree_to], [4, 2]);
  assert.equal(body(await getReviewTask(rt14.id)).code, "RT-14");
});

test("a blind reviewer sees only their own comments and the researcher's", async () => {
  const threads = (await listSlideThreads(a1.id)).data;
  const t2 = threads.find((thread) => thread.anchor === "T2");
  assert.ok(t2);
  const comments = (await listThreadComments(t2.id)).data;
  assert.equal(comments.length, 3);
  assert.equal(comments.filter((item) => item.reply_to !== null).length, 2);
  assert.ok(comments.every((item) => item.text !== "Boundary looks fine to me."));
  assert.equal(comments[0]?.author_is_researcher, true);
});

test("the Slide done card, the display locks and the next slide come from the scenario", async () => {
  assert.ok(rt14);
  const opinion = body(await getOpinion(rt14.id, a1.id));
  assert.deepEqual(
    opinion.questions.map((question) => question.label),
    [
      "Is the AI result acceptable for this slide?",
      "Main error type",
      "Would you sign this without changes?",
      "Comment",
    ],
  );
  assert.equal(opinion.answers["acceptable"], 4);
  const display = (await getTaskDisplay(rt14.id)).data;
  assert.equal(display.locks[0]?.setting, "order");
  assert.ok(display.presets.some((preset) => preset.name === "Dots, no IDs"));
  const neighbours = body(await getSlideNeighbours(a1.id, { from: "task", task_id: rt14.id }));
  assert.deepEqual([neighbours.position, neighbours.total], [8, 12]);
  assert.equal(neighbours.next?.label, "A2");
  const agreement = (await getSlideAgreement(rt14.id, a1.id)).data;
  assert.deepEqual([agreement.agree, agreement.total], [51, 55]);
});

test("another viewer gets no review of A1", async () => {
  assert.ok(rt14);
  setFakeView({ viewer: "AK", firstWeek: false });
  assert.equal((await listReviewObjects(rt14.id, a1.id)).data.objects.length, 0);
});

test("RT-16 is the task the new task flow sends, and slide 9 opens with its objects open", async () => {
  assert.ok(rt14);
  assert.equal(scenarioReview.rt16.id, scenarioTask.newTask.id);
  const a2 = scenario.slideByIndex(2);
  const next = (await listReviewObjects(rt14.id, a2.id)).data;
  assert.equal(next.objects.filter((item) => item.kind === "region").length, 2);
  assert.equal(next.objects.filter((item) => item.kind === "cell").length, 50);
  assert.equal(body(await listVerdicts(rt14.id, a2.id)).length, 0);
  assert.equal(next.slide.label, "A2");
});
