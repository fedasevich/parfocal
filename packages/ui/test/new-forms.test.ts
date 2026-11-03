import assert from "node:assert/strict";
import { test } from "node:test";
import {
  casePatient,
  caseProblem,
  defaultTaxonomyFor,
  projectProblem,
} from "../src/lib/new-forms.ts";

test("a project needs a name", () => {
  const base = { name: "", privacy: "clinical", template: "none", taxonomy: "pannuke" } as const;
  assert.equal(projectProblem(base), "Give the project a name.");
  assert.equal(projectProblem({ ...base, name: "  " }), "Give the project a name.");
  assert.equal(projectProblem({ ...base, name: "Fake study" }), null);
});

test("the cell review template starts with the PanNuke classes and the others with sentinel node", () => {
  assert.equal(defaultTaxonomyFor("cell-review"), "pannuke");
  assert.equal(defaultTaxonomyFor("sentinel-node"), "sentinel-node");
  assert.equal(defaultTaxonomyFor("none"), "sentinel-node");
});

test("a case needs an ID, and a birth number needs a name in a clinical project only", () => {
  const onlyNumber = { name: "", birthNumber: "FAKE-0001" };
  assert.equal(caseProblem("", onlyNumber, true), "Give the case an ID.");
  assert.equal(
    caseProblem("S26-1", onlyNumber, true),
    "Add the patient's name, or clear the birth number.",
  );
  assert.equal(caseProblem("S26-1", onlyNumber, false), null);
  assert.equal(caseProblem("S26-1", { name: "Fake Patient", birthNumber: "" }, true), null);
});

test("patient fields never leave a de-identified project", () => {
  const typed = { name: " Fake Patient ", birthNumber: " FAKE-0001 " };
  assert.equal(casePatient(typed, false), null);
  assert.deepEqual(casePatient(typed, true), { name: "Fake Patient", birthNumber: "FAKE-0001" });
  assert.equal(casePatient({ name: " ", birthNumber: "" }, true), null);
});
