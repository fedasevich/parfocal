import assert from "node:assert/strict";
import { test } from "node:test";
import { scenario } from "../src/fake/index.ts";

const { people, projects, cases, slides, resultSets, reviewTasks, jobs, workspaces } = scenario;

test("ids are unique across the whole scenario", () => {
  const ids = [
    ...Object.values(people),
    ...workspaces,
    ...projects,
    ...cases,
    ...slides,
    ...resultSets,
    ...reviewTasks,
    ...jobs,
  ].map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every reference points at something in the scenario", () => {
  const projectCodes = new Set(projects.map((project) => project.code));
  const caseLabels = new Set(cases.map((item) => item.label));
  for (const project of projects) {
    assert.ok(project.members.includes(project.owner), `${project.code} owner is a member`);
  }
  for (const item of cases) assert.ok(projectCodes.has(item.project), item.label);
  for (const slide of slides) {
    assert.ok(projectCodes.has(slide.project), slide.label);
    if (slide.caseLabel !== null) {
      assert.ok(caseLabels.has(slide.caseLabel), slide.caseLabel);
      const owner = cases.find((item) => item.label === slide.caseLabel);
      assert.equal(owner?.project, slide.project, `${slide.caseLabel}/${slide.label}`);
    }
  }
  for (const task of reviewTasks) {
    const project = scenario.projectByCode(task.project);
    for (const reviewer of task.reviewers) {
      assert.ok(project.members.includes(reviewer), `${task.code} reviewer ${reviewer}`);
    }
    assert.ok(
      resultSets.some((set) => set.key === task.resultSet),
      task.code,
    );
  }
  for (const job of jobs) assert.ok(projectCodes.has(job.project), job.title);
});

test("object IDs follow the mock's format", () => {
  assert.equal(scenario.objectIds.region(1), "T2");
  assert.equal(scenario.objectIds.cell(44, 1), "T2·C145");
  const full = scenario.objectIds.full("P07", "S26-04812", "A1", scenario.resumePoint.object);
  assert.equal(full, "P07/S26-04812/A1/T5");
  assert.equal(
    scenario.objectIds.full("P07", "S26-04812", "A1", "T2·C145"),
    "P07/S26-04812/A1/T2·C145",
  );
  assert.match(full, scenario.fullObjectIdPattern);
  assert.doesNotMatch("P07/S26-04812/A1/C145", scenario.fullObjectIdPattern);
});

test("the resume point is a slide the signed-in person reviews", () => {
  const point = scenario.resumePoint;
  const task = reviewTasks.find((item) => item.code === point.task);
  assert.ok(task?.reviewers.includes(scenario.signedInAs));
  assert.equal(task?.project, point.project);
  const slide = scenario.slideOf(point.project, point.caseLabel, point.slideLabel);
  assert.equal(slide.state, "ready");
});

test("the scenario holds no patient identity", () => {
  const text = JSON.stringify(scenario);
  for (const field of ["patient", "birth", "mrn", "insurance"]) {
    assert.ok(!text.toLowerCase().includes(field), field);
  }
  for (const person of Object.values(people)) assert.match(person.email, /@fnvltava\.example$/);
});
