import assert from "node:assert/strict";
import { test } from "node:test";
import { caseDetailsOf, specimenText } from "../src/screens/review/case-details.ts";

const block = (number: number) => ({
  id: `b${number}`,
  number,
  description: null,
  stains: ["H&E"],
  levels: 1,
});

test("the case details carry each field from the case, project and task", () => {
  const details = caseDetailsOf({
    projectName: "Demo project",
    clinical: false,
    caseLabel: "S26-00001",
    specimens: [
      {
        letter: "A",
        type: "Lymph node",
        site: "sentinel",
        laterality: "left",
        blocks: [block(2), block(1)],
      },
      { letter: "B", type: null, site: null, laterality: "unknown", blocks: [block(1)] },
    ],
    taskTitle: "RT-1 · First read",
    researcher: "Demo Researcher",
  });
  assert.deepEqual(details, {
    project: "Demo project",
    caseLabel: "S26-00001",
    specimen: "A · Lymph node, sentinel, left",
    blocks: ["A1", "A2", "B1"],
    task: "RT-1 · First read",
    researcher: "Demo Researcher",
    clinical: false,
    clinicalNote: undefined,
  });
});

test("missing data stays undefined so the picker says it is missing", () => {
  const details = caseDetailsOf({ clinical: true, specimens: [] });
  assert.equal(details.project, undefined);
  assert.equal(details.caseLabel, undefined);
  assert.equal(details.specimen, undefined);
  assert.deepEqual(details.blocks, []);
  assert.equal(details.task, undefined);
  assert.equal(details.researcher, undefined);
  assert.equal(details.clinical, true);
  assert.equal(details.clinicalNote, undefined);
});

test("a specimen without words shows only its letter", () => {
  assert.equal(
    specimenText({ letter: "C", type: " ", site: null, laterality: "not-applicable" }),
    "C",
  );
  assert.equal(
    specimenText({ letter: "D", type: null, site: "Skin, back", laterality: "right" }),
    "D · Skin, back, right",
  );
});
