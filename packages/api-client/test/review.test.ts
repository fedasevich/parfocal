import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeView,
  fakeApiHandlers,
  resetFakeThreads,
  scenario,
  scenarioReview,
  scenarioTask,
  setFakeView,
} from "../src/fake/index.ts";
import {
  createThread,
  createThreadOnSlide,
  getOpinion,
  getReviewOrder,
  getReviewTask,
  getSlideAgreement,
  getSlideNeighbours,
  getTaskDisplay,
  listMentionableMembers,
  listReviewObjects,
  listSlideThreads,
  listThreadComments,
  listThreads,
  listThreadsOnSlide,
  listVerdicts,
  resolveThreadOnSlide,
  saveVerdict,
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
  resetFakeThreads();
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
  const decision14 = body(await getReviewTask(rt14.id)).decision;
  assert.equal(decision14.style, "agree");
  const rt16 = scenarioReview.rt16;
  const task16 = body(await getReviewTask(rt16.id));
  assert.equal(task16.name, "Round 3 · CAMELYON v1.0");
  assert.equal(task16.decision.style, "certainty");
  assert.deepEqual(task16.decision.counts_as, ["disagree", "disagree", "unsure", "agree", "agree"]);
  assert.equal(body(await getReviewTask(rt14.id)).code, "RT-14");
});

test("saving a 5-point certainty answer on RT-16 counts it through the task's mapping", async () => {
  const rt16 = scenarioReview.rt16;
  const first = scenarioReview.reviewObjects[0];
  assert.ok(first);
  const save = async (answer: string) =>
    body(await saveVerdict(rt16.id, a1.id, first.object, { answer }));
  assert.deepEqual(
    [await save("5"), await save("3"), await save("2")].map((item) => [item.answer, item.value]),
    [
      ["5", "agree"],
      ["3", "unsure"],
      ["2", "disagree"],
    ],
  );
  assert.equal((await save("unsure")).style, "certainty");
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

test("the slide's threads come with titles, authors and a resolved state, filtered on request", async () => {
  assert.ok(rt14);
  const all = body(await listThreads(rt14.id, a1.id));
  assert.deepEqual(
    all.map((thread) => [thread.anchor.object_id, thread.resolved_at === null]),
    [
      ["T2", true],
      ["T1·C145", true],
      ["R2⁺", true],
      ["T4", false],
    ],
  );
  assert.equal(all[0]?.message_count, 3);
  assert.equal(all[2]?.anchor.kind, "roi");
  assert.deepEqual(
    body(await listThreads(rt14.id, a1.id, { resolved: true })).map((thread) => thread.title),
    ["Reactive sinus histiocytes, no atypia"],
  );
  assert.equal(body(await listThreads(rt14.id, a1.id, { resolved: false })).length, 3);
  assert.deepEqual(body(await listThreads(rt14.id, scenario.slideByIndex(2).id)), []);
});

test("a blinded reviewer can mention only the researcher, the researcher anyone else", async () => {
  assert.ok(rt14);
  const asReviewer = body(await listMentionableMembers(rt14.id, a1.id));
  assert.deepEqual(
    asReviewer.map((member) => member.user_id),
    [scenario.people.DH.id],
  );
  setFakeView({ viewer: "DH", firstWeek: false });
  const asResearcher = body(await listMentionableMembers(rt14.id, a1.id));
  assert.equal(asResearcher.length, Object.keys(scenario.people).length - 1);
  assert.ok(asResearcher.every((member) => member.user_id !== scenario.people.DH.id));
});

test("a thread posted with a point anchor is listed back with its first message", async () => {
  assert.ok(rt14);
  const before = body(await listThreads(rt14.id, a1.id)).length;
  const response = await createThread(rt14.id, a1.id, {
    title: "Check this corner",
    body: "Is this fold real?",
    anchor: {
      kind: "point",
      object_id: null,
      geometry: { type: "Point", coordinates: [120, 340] },
      offset: null,
    },
  });
  assert.equal(response.status, 201);
  const created = response.data as { id: string };
  const all = body(await listThreads(rt14.id, a1.id));
  assert.equal(all.length, before + 1);
  const posted = all.find((thread) => thread.id === created.id);
  assert.equal(posted?.title, "Check this corner");
  assert.equal(posted?.anchor.kind, "point");
  assert.equal(posted?.message_count, 1);
  const open = body(await listThreads(rt14.id, a1.id, { resolved: false }));
  assert.ok(open.some((thread) => thread.id === created.id));
  const comments = (await listThreadComments(created.id)).data;
  assert.equal(comments[0]?.text, "Is this fold real?");
});

test("a thread posted on a slide with no task lists apart from the task's threads", async () => {
  assert.ok(rt14);
  const project = body(await getReviewTask(rt14.id)).project_id;
  const onTask = body(await listThreads(rt14.id, a1.id)).length;
  assert.deepEqual(body(await listThreadsOnSlide(project, a1.id)), []);
  const response = await createThreadOnSlide(project, a1.id, {
    title: "Before any task",
    body: "Is this fold real?",
    anchor: {
      kind: "point",
      object_id: null,
      geometry: { type: "Point", coordinates: [10, 20] },
      offset: null,
    },
  });
  assert.equal(response.status, 201);
  const created = response.data as { id: string; task_id: string | null };
  assert.equal(created.task_id, null);
  const listed = body(await listThreadsOnSlide(project, a1.id));
  assert.deepEqual(
    listed.map((thread) => [thread.title, thread.task_id]),
    [["Before any task", null]],
  );
  assert.equal(body(await listThreads(rt14.id, a1.id)).length, onTask);
  body(await resolveThreadOnSlide(project, a1.id, created.id));
  assert.deepEqual(body(await listThreadsOnSlide(project, a1.id, { resolved: false })), []);
});
