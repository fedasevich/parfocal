import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CaseDetail,
  ResultSet,
  ReviewTaskDetail,
  SlideRow,
  Verdict,
} from "@parfocal/api-client";
import { shapeCaseLoad } from "../src/viewer/case-load.ts";

const slideOf = (id: string, caseId: string | null): SlideRow =>
  ({
    id,
    label: `A-${id}`,
    case_id: caseId,
    case_label: caseId ? "S26-04812" : null,
    result_sets: [],
    reviews: [],
  }) as unknown as SlideRow;

const caseDetail = {
  id: "c-1",
  project_id: "p-1",
  label: "S26-04812",
  source: "manual",
  patient: {
    id: "pt-1",
    name: "Test Patient",
    mrn: "000",
    birth_date: null,
    sex: "unknown",
    age_years: null,
  },
  specimens: [],
  slides: [{ id: "s-1" }, { id: "s-2" }],
} as unknown as CaseDetail;

const task = { id: "t-1", code: "RT-14", name: "Round 2" } as ReviewTaskDetail;
const decision = { object: "T5", answer: "agree" } as Verdict;
const resultSet = { id: "r-1", slide_id: "s-1" } as ResultSet;

const project = (privacy_mode: "clinical" | "de-identified") => ({
  id: "p-1",
  code: "P07",
  name: "CAMELYON",
  privacy_mode,
});

const base = {
  slideId: "s-1",
  slides: [slideOf("s-1", "c-1"), slideOf("s-2", "c-1"), slideOf("s-3", null)],
  caseDetail,
  resultSets: [resultSet],
  task,
  decisions: [decision],
};

test("a clinical project keeps the patient of the case", () => {
  const load = shapeCaseLoad({ ...base, project: project("clinical") });
  assert.equal(load.clinical, true);
  assert.equal(load.patient?.name, "Test Patient");
});

test("a de-identified project never carries patient fields", () => {
  const load = shapeCaseLoad({ ...base, project: project("de-identified") });
  assert.equal(load.clinical, false);
  assert.equal(load.patient, null);
});

test("the case lists the slides it holds and the slide, result sets and task come along", () => {
  const load = shapeCaseLoad({ ...base, project: project("clinical") });
  assert.deepEqual(load.case, { id: "c-1", label: "S26-04812", slideIds: ["s-1", "s-2"] });
  assert.deepEqual(load.slide, { id: "s-1", label: "A-s-1" });
  assert.equal(load.resultSets.length, 1);
  assert.equal(load.task?.code, "RT-14");
  assert.equal(load.decisions.length, 1);
});

test("a loose slide has no case and no patient even in a clinical project", () => {
  const load = shapeCaseLoad({ ...base, slideId: "s-3", project: project("clinical") });
  assert.equal(load.case, null);
  assert.equal(load.patient, null);
});

test("before the case detail arrives the case falls back to the project's slide list", () => {
  const load = shapeCaseLoad({ ...base, caseDetail: undefined, project: project("clinical") });
  assert.deepEqual(load.case?.slideIds, ["s-1", "s-2"]);
  assert.equal(load.patient, null);
});

test("without a task there are no decisions", () => {
  const load = shapeCaseLoad({ ...base, task: undefined, project: project("de-identified") });
  assert.equal(load.task, null);
  assert.deepEqual(load.decisions, []);
});

test("a slide the project does not list loads without a slide or case", () => {
  const load = shapeCaseLoad({ ...base, slideId: "gone", project: project("clinical") });
  assert.equal(load.slide, null);
  assert.equal(load.case, null);
});
