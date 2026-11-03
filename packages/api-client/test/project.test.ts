import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario } from "../src/fake/index.ts";
import {
  changeReviewTask,
  getOpinionForm,
  getProjectImports,
  getProjectOverview,
  getReviewTask,
  getTaskEvaluation,
  getUploadBatch,
  listClassMappings,
  listMySlides,
  listProjectClasses,
  listReviewTasks,
  listSlideResultSets,
  listSourceFiles,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const p07 = scenario.projectByCode("P07");
const a1 = scenario.slideOf("P07", "S26-04812", "A1");

test("the project overview reads the same counts as the scenario project", async () => {
  const overview = (await getProjectOverview(p07.id)).data;
  assert.equal(overview.slides, p07.counts.slides);
  assert.equal(overview.cases, p07.counts.cases);
  assert.equal(overview.reviewed_percent, p07.counts.reviewedPercent);
  assert.equal(overview.objects, 412880);
  assert.deepEqual(
    overview.case_groups.map((group) => [group.label, group.slide_count]),
    [
      ["S26-04812", 3],
      ["S26-04769", 9],
      ["S26-04777", 2],
      ["S26-04740", 2],
      ["S26-04751", 1],
    ],
  );
  assert.equal(overview.import_failure?.slide_label, "tumor_044");
  const remote = overview.slide_files.find((file) => file.remote !== null);
  assert.equal(remote?.remote, "S3");
});

test("a project's slides keep the scenario ids, and My work still gets its own list", async () => {
  const response = await listMySlides({ project_id: p07.id });
  assert.equal(response.status, 200);
  const rows = response.status === 200 ? response.data.slides : [];
  const own = scenario.slides.filter((slide) => slide.project === "P07");
  assert.deepEqual(
    rows.map((row) => row.id),
    own.map((slide) => slide.id),
  );
  const first = rows.find((row) => row.id === a1.id);
  assert.deepEqual(
    first?.reviews.map((review) => review.state),
    ["in-review", "submitted"],
  );
  const mine = await listMySlides();
  const mineRows = mine.status === 200 ? mine.data.slides : [];
  assert.deepEqual(
    mineRows.map((row) => row.id),
    scenario.myWorkSlideIds,
  );
});

test("A1 lists its imported and run result sets, and the reviewed layer is not one", async () => {
  const response = await listSlideResultSets(a1.id);
  const sets = response.status === 200 ? response.data : [];
  assert.deepEqual(
    sets.map((set) => [set.name, set.source]),
    [
      ["CAMELYON tumor model", "import"],
      ["PathoSAM + HoVer-NeXt", "run"],
    ],
  );
});

test("P07's review tasks, classes, mappings and opinion form come from the scenario", async () => {
  const tasks = await listReviewTasks(p07.id);
  assert.deepEqual(
    (tasks.status === 200 ? tasks.data : []).map((task) => task.code),
    ["RT-14", "RT-15", "RT-09", "RT-13"],
  );
  const classes = await listProjectClasses(p07.id);
  const names = (classes.status === 200 ? classes.data : []).map((item) => item.name);
  assert.deepEqual(names, ["Tumor", "Stroma", "Immune", "Other"]);
  const mappings = await listClassMappings(p07.id);
  assert.equal(mappings.status === 200 ? mappings.data.length : 0, 3);
  const form = await getOpinionForm(p07.id);
  assert.deepEqual(
    (form.status === 200 ? form.data.questions : []).map((question) => question.kind),
    ["scale", "choice", "yesno", "text"],
  );
});

test("the upload batch pairs its results and names three problems", async () => {
  const batch = (await getUploadBatch(p07.id)).data;
  assert.equal(batch.slides.length, 6);
  assert.equal(batch.results.length, 4);
  assert.equal(batch.results[2]?.pairings.auto.slide, null);
  assert.equal(batch.results[2]?.pairings.name.warn, "Check this");
  assert.deepEqual(
    batch.problems.map((problem) => problem.kind),
    ["read-error", "scale", "new-classes"],
  );
  assert.equal(batch.storage.allowance_gb, 525);
});

test("a source listing and the automatic imports answer for the project", async () => {
  const listing = (await listSourceFiles(p07.id, "s3://fnvltava-scans/sentinel/2026-10/")).data;
  assert.equal(listing.kind, "storage");
  assert.equal(listing.files.filter((file) => file.in_project).length, 1);
  const imports = (await getProjectImports(p07.id)).data;
  assert.equal(imports.arrivals.length, 4);
  assert.equal(imports.webhook.on, true);
});

test("Counts as changes on RT-13, recounts its answers, logs the change and locks after sign-off", async () => {
  const tasks = await listReviewTasks(p07.id);
  const rt13 = (tasks.status === 200 ? tasks.data : []).find((task) => task.code === "RT-13");
  assert.ok(rt13);
  const edit = await changeReviewTask(rt13.id, {
    decision: {
      style: "certainty",
      counts_as: ["disagree", "disagree", "unsure", "unsure", "agree"],
    },
  });
  assert.equal(edit.status, 200);
  const detail = await getReviewTask(rt13.id);
  assert.equal(detail.status === 200 ? detail.data.counts_as_changes[0]?.recounted : -1, 8);
  const evaluation = await getTaskEvaluation(rt13.id);
  assert.deepEqual(evaluation.status === 200 ? evaluation.data.decisions.counted : {}, {
    agree: 9,
    disagree: 6,
    unsure: 13,
  });
  await assert.rejects(
    changeReviewTask(rt13.id, {
      decision: {
        style: "certainty",
        counts_as: ["unsure", "unsure", "unsure", "unsure", "agree"],
      },
    }),
    { kind: "validation" },
  );
  const rt09 = scenario.reviewTasks.find((task) => task.code === "RT-09");
  await assert.rejects(
    changeReviewTask(rt09?.id ?? "", {
      decision: { style: "agree", counts_as: ["disagree", "disagree", "unsure", "agree", "agree"] },
    }),
    { kind: "conflict" },
  );
});
