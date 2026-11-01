import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario, scenarioTask } from "../src/fake/index.ts";
import {
  createReviewTask,
  getProjectScopeOptions,
  getReviewTaskDefaults,
  listAvailability,
  listProjectResultSets,
  listProjectSlides,
  listReviewerWorkload,
  listStudyTemplateReviewDefaults,
  listStudyTemplates,
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

test("the defaults pick 12 slides and 9 of them carry CAMELYON v1.0", async () => {
  const defaults = (await getReviewTaskDefaults(p07.id)).data;
  const slides = (await listProjectSlides(p07.id)).data;
  const picked = slides.filter((slide) => defaults.slide_ids.includes(slide.id));
  assert.equal(defaults.code, "RT-16");
  assert.equal(picked.length, 12);
  assert.equal(
    picked.filter((slide) => slide.result_set_ids.includes(defaults.result_set_id)).length,
    9,
  );
  assert.equal(
    defaults.names.find((name) => name.result_set_id === defaults.result_set_id)?.name,
    "Round 3 · CAMELYON v1.0",
  );
});

test("the defaults' result sets are the project's own", async () => {
  const defaults = (await getReviewTaskDefaults(p07.id)).data;
  const sets = await listProjectResultSets(p07.id);
  assert.equal(sets.status, 200);
  const ids = sets.status === 200 ? sets.data.map((set) => set.id) : [];
  for (const name of defaults.names) assert.ok(ids.includes(name.result_set_id), name.name);
});

test("the defaults name Lenka Malá and Simona Marková, due on 30 October", async () => {
  const defaults = (await getReviewTaskDefaults(p07.id)).data;
  assert.deepEqual(defaults.reviewer_ids, [scenario.people.LM.id, scenario.people.SM.id]);
  assert.equal(defaults.due_on, "2026-10-30");
  assert.ok(defaults.today < defaults.due_on);
});

test("another project has no slides to pick", async () => {
  assert.deepEqual((await listProjectSlides(scenario.projectByCode("P09").id)).data, []);
});

test("study templates and their review defaults line up one to one", async () => {
  const templates = await listStudyTemplates();
  const defaults = (await listStudyTemplateReviewDefaults()).data;
  assert.equal(templates.status, 200);
  const list = templates.status === 200 ? templates.data : [];
  assert.deepEqual(
    list.map((template) => template.id),
    defaults.templates.map((template) => template.template_id),
  );
  const sentinel = defaults.templates[0];
  assert.equal(sentinel?.decision.kind, "certainty5");
  assert.deepEqual(sentinel?.scope_kinds, ["regions", "cells"]);
  const cellTyping = defaults.templates.find(
    (template) => template.template_id === scenarioTask.studyTemplates[3]?.id,
  );
  assert.equal(cellTyping?.display.draw, "dots");
  assert.equal(cellTyping?.display.ids, false);
  for (const template of defaults.templates) {
    assert.ok(defaults.opinion_forms.some((form) => form.key === template.opinion_form));
  }
});

test("Petra Králová is away until 22 October and has no open tasks", async () => {
  const availability = await listAvailability();
  const workload = (await listReviewerWorkload()).data;
  const pk = scenario.people.PK.id;
  assert.equal(availability.status, 200);
  if (availability.status === 200) {
    assert.deepEqual(
      availability.data.map((item) => [item.user_id, item.until]),
      [[pk, "2026-10-22"]],
    );
  }
  assert.equal(workload.find((item) => item.user_id === pk)?.open_tasks, 0);
  assert.equal(workload.length, 6);
});

test("the project offers five ROIs and five unsure zones", async () => {
  const options = (await getProjectScopeOptions(p07.id)).data;
  assert.equal(options.rois.length, 5);
  assert.deepEqual(
    options.unsure_zones.map((zone) => zone.key),
    ["Z1", "Z2", "Z3", "Z4", "Z5"],
  );
});

test("creating the task answers RT-16 with what was sent", async () => {
  const defaults = (await getReviewTaskDefaults(p07.id)).data;
  const response = await createReviewTask(p07.id, {
    name: "Round 3 · CAMELYON v1.0",
    reviewer_ids: defaults.reviewer_ids,
    split: "everyone",
    scope: { kind: "all-regions" },
    result_sets: defaults.slide_ids.slice(0, 9).map((slide_id) => ({
      slide_id,
      result_set_id: defaults.result_set_id,
    })),
    due_on: defaults.due_on,
  });
  assert.equal(response.status, 201);
  if (response.status === 201) {
    assert.equal(response.data.code, "RT-16");
    assert.equal(response.data.slide_count, 9);
    assert.equal(response.data.reviewer_count, 2);
    assert.equal(response.data.due_on, "2026-10-30");
  }
});
