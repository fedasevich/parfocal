import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { defaultFakeView, fakeApiHandlers, scenario, setFakeView } from "../src/fake/index.ts";
import {
  type AnnouncementDraft,
  createAnnouncement,
  endAnnouncement,
  getMe,
  getMyChecklist,
  getMyHome,
  getNotificationCounts,
  getReviewOrder,
  getReviewTask,
  getReviewTaskStates,
  listAnnouncements,
  listMyAdjudications,
  listMyCosignRequests,
  listMyReviewTasks,
  listMySlides,
  listNotifications,
  listProjectResultSets,
  listSlideThreads,
  listTasksAssignedByMe,
  listVerdicts,
  markNotificationsRead,
  search,
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

test("setting the fake view reports whether anything changed", () => {
  assert.equal(setFakeView(defaultFakeView), false);
  assert.equal(setFakeView({ viewer: "AK", firstWeek: false }), true);
  assert.equal(setFakeView({ viewer: "AK", firstWeek: false }), false);
});

test("the viewer decides who is signed in and what they review", async () => {
  setFakeView({ viewer: "AK", firstWeek: false });
  assert.equal(body(await getMe()).display_name, "Anna Kopecká");
  const tasks = body(await listMyReviewTasks());
  const rt15 = tasks.find((task) => task.code === "RT-15");
  assert.equal(rt15?.status, "not-started");
  assert.equal(rt15?.slides_assigned, 12);
  const home = body(await getMyHome());
  assert.equal(home.resume, null);
  const adjudications = body(await listMyAdjudications());
  assert.deepEqual(adjudications[0]?.objects, ["T4", "T5", "T1·C145"]);
  assert.equal(adjudications[0]?.task_code, "RT-14");
});

test("only Anna has objects to adjudicate and only Lenka has a co-sign ask", async () => {
  assert.deepEqual(body(await listMyAdjudications()), []);
  const asks = body(await listMyCosignRequests());
  assert.equal(asks[0]?.case_label, "S26-04812");
  assert.equal(asks[0]?.project.code, "P03");
  setFakeView({ viewer: "AK", firstWeek: false });
  assert.deepEqual(body(await listMyCosignRequests()), []);
});

test("an even split gives each reviewer their share of the slides", async () => {
  const rt11 = body(await listMyReviewTasks()).find((task) => task.code === "RT-11");
  assert.equal(rt11?.slides_assigned, 14);
  assert.equal(rt11?.status, "signed-off");
});

test("Daniel's assigned tasks show RT-14 waiting on its disagreements", async () => {
  setFakeView({ viewer: "DH", firstWeek: false });
  const tasks = body(await listTasksAssignedByMe());
  assert.deepEqual(
    tasks.map((task) => [task.code, task.status]),
    [
      ["RT-14", "disagreements"],
      ["RT-15", "not-started"],
      ["RT-11", "signed-off"],
      ["RT-09", "signed-off"],
    ],
  );
  assert.equal(tasks[0]?.open_disagreements, 7);
  assert.deepEqual(
    tasks[2]?.reviewers.map((reviewer) => reviewer.slides_assigned),
    [14, 14, 14],
  );
});

test("the first week shows the sample project, the checklist and no resume point", async () => {
  const usual = body(await getMyHome());
  assert.equal(usual.week.objects_checked, 147);
  assert.equal(usual.week.open_disagreements, 3);
  assert.equal(usual.slides_without_results, 2);
  assert.equal(usual.announcements.length, 3);
  assert.equal(usual.projects[0]?.slides, 61);
  assert.deepEqual(
    usual.projects[0]?.strip.map((slide) => slide.reviewed),
    [true, true, false, false],
  );
  assert.equal((await getMyChecklist()).data.hidden, true);
  setFakeView({ viewer: "LM", firstWeek: true });
  const first = body(await getMyHome());
  assert.equal(first.resume, null);
  assert.deepEqual(
    first.projects.map((project) => project.code),
    ["S01", "P07"],
  );
  assert.equal(first.announcements.length, 1);
  const checklist = (await getMyChecklist()).data;
  assert.equal(checklist.hidden, false);
  assert.equal(checklist.steps.filter((step) => step.done).length, 3);
});

test("My work's slides are the mock's seven rows with their sets and reviews", async () => {
  const page = body(await listMySlides());
  assert.deepEqual(
    page.slides.map((slide) => [slide.label, slide.status]),
    [
      ["A1", "in-review"],
      ["A2", "in-review"],
      ["A3", "uploaded"],
      ["tumor_031", "in-review"],
      ["tumor_044", "in-review"],
      ["tumor_052", "uploaded"],
      ["tumor_090", "ready"],
    ],
  );
  assert.deepEqual(
    page.slides[0]?.result_sets.map((set) => set.name),
    ["CAMELYON tumor model v1.0", "PathoSAM + HoVer-NeXt v1.2", "Reviewed live"],
  );
});

test("the bell lists, filters, counts and marks notifications read", async () => {
  const all = body(await listNotifications()).notifications;
  assert.equal(all.length, 7);
  const mentions = body(await listNotifications({ kind: ["mention", "reply"] })).notifications;
  assert.equal(mentions.length, 2);
  assert.equal(mentions[0]?.payload["object_id"], "T2");
  assert.match(mentions[0]?.link ?? "", /^\/tasks\/.+\/comments\?slide=.+&thread=T2$/);
  const counts = body(await getNotificationCounts());
  assert.equal(counts.unread, 5);
  const marked = body(await markNotificationsRead({ ids: [all[0]?.id ?? ""] }));
  assert.deepEqual(marked, { marked: 1, unread: 4 });
  assert.equal(body(await getNotificationCounts()).unread, 4);
});

test("search finds projects, slides, objects and people, ignoring accents", async () => {
  const p07 = body(await search({ q: "sentinel" })).hits.map((hit) => hit.label);
  assert.ok(p07.includes("P07 · Sentinel node AI evaluation"));
  const objects = body(await search({ q: "T2·C145" })).hits;
  assert.equal(objects[0]?.kind, "object");
  const people = body(await search({ q: "mala" })).hits.map((hit) => hit.label);
  assert.deepEqual(people, ["Lenka Malá"]);
});

test("the preview of A1 reads its decisions, its object count and its open threads", async () => {
  const task = scenario.reviewTasks.find((item) => item.code === "RT-14");
  const a1 = scenario.slideByIndex(1);
  assert.ok(task);
  const verdicts = body(await listVerdicts(task.id, a1.id));
  assert.equal(verdicts.length, 48);
  assert.equal(verdicts.filter((verdict) => verdict.value === "disagree").length, 3);
  assert.equal(body(await getReviewOrder(task.id, a1.id)).total, 55);
  const threads = (await listSlideThreads(a1.id)).data;
  assert.deepEqual(
    threads.filter((thread) => !thread.resolved).map((thread) => thread.anchor),
    ["T2", "T1·C145", "R2⁺"],
  );
});

test("a task's detail and its project's result sets come from the scenario", async () => {
  const rt11 = scenario.reviewTasks.find((item) => item.code === "RT-11");
  assert.ok(rt11);
  const detail = body(await getReviewTask(rt11.id));
  assert.equal(detail.split, "even");
  assert.equal(detail.slide_count, 40);
  assert.equal(detail.blinded, true);
  assert.equal(body(await getReviewTaskStates(rt11.id)).signed_off_at?.slice(0, 10), "2026-10-14");
  const sets = body(await listProjectResultSets(detail.project_id));
  const used = sets.find((set) => set.id === detail.slides[0]?.result_set_id);
  assert.equal(used?.name, "PathoSAM + HoVer-NeXt");
  assert.equal(used?.model_version, "v1.2");
  assert.equal(used?.source, "run");
});

test("notifications go to Lenka only and All slides filters by case or label", async () => {
  setFakeView({ viewer: "AK", firstWeek: false });
  assert.equal(body(await listNotifications()).notifications.length, 0);
  assert.equal(body(await getNotificationCounts()).unread, 0);
  setFakeView(defaultFakeView);
  const tumors = body(await listMySlides({ q: "tumor" })).slides.map((slide) => slide.label);
  assert.deepEqual(tumors, ["tumor_031", "tumor_044", "tumor_052", "tumor_090"]);
  const caseRows = body(await listMySlides({ q: "s26-04812" })).slides;
  assert.equal(caseRows.length, 3);
});

test("a task's states give each reviewer their submitted slides first", async () => {
  const rt14 = scenario.reviewTasks.find((item) => item.code === "RT-14");
  const rt11 = scenario.reviewTasks.find((item) => item.code === "RT-11");
  assert.ok(rt14 && rt11);
  const states = body(await getReviewTaskStates(rt14.id));
  assert.equal(states.slides.length, 12);
  assert.equal(new Set(states.slides.map((slide) => slide.slide_id)).size, 12);
  const submittedBy = (key: "LM" | "SM") =>
    states.slides.filter((slide) =>
      slide.reviewers.some(
        (reviewer) =>
          reviewer.user_id === scenario.people[key].id && reviewer.state === "submitted",
      ),
    ).length;
  assert.equal(submittedBy("LM"), 7);
  assert.equal(submittedBy("SM"), 4);
  assert.equal(states.slides[0]?.state, "submitted");
  assert.equal(states.slides[5]?.state, "in-review");
  assert.equal(states.slides[11]?.state, "assigned");
  const even = body(await getReviewTaskStates(rt11.id));
  assert.equal(even.slides.length, 40);
  assert.ok(even.slides.every((slide) => slide.reviewers.length === 1));
  assert.ok(even.slides.every((slide) => slide.state === "signed-off"));
});

async function post(draft: AnnouncementDraft) {
  const response = await createAnnouncement(draft);
  if (response.status !== 201) throw new Error(`Posting failed with ${response.status}`);
  return response.data;
}

const listedIds = async () => body(await listAnnouncements()).map((item) => item.id);

test("a posted announcement lists first and on Home, and ending it removes it", async () => {
  const before = await listedIds();
  assert.equal(before.length, 3);
  const posted = await post({ kind: "slowdown", text: "  Server is slow  " });
  assert.equal(posted.text, "Server is slow");
  assert.deepEqual(await listedIds(), [posted.id, ...before]);
  assert.equal(body(await getMyHome()).announcements[0]?.id, posted.id);
  await endAnnouncement(posted.id);
  assert.deepEqual(await listedIds(), before);
  assert.equal(body(await getMyHome()).announcements.length, 3);
});

test("a posted announcement whose end time has passed is not listed", async () => {
  const lapsed = await post({
    kind: "change",
    text: "Old news",
    ends_at: "2026-10-15T14:00:00+02:00",
  });
  const lasting = await post({
    kind: "model",
    text: "New model",
    ends_at: "2026-10-15T15:30:00+02:00",
  });
  const ids = await listedIds();
  assert.equal(ids.includes(lapsed.id), false);
  assert.equal(ids.includes(lasting.id), true);
  await endAnnouncement(lasting.id);
});
