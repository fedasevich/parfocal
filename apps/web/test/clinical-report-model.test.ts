import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  defaultFakeView,
  scenario,
  setFakeView,
  toClinicalReport,
} from "@parfocal/api-client/fake";
import {
  amendmentChanges,
  categoryOf,
  diagnosisOf,
  issuesOf,
  largestMm,
  nextDepositId,
  positiveNodes,
  sceneReport,
  sceneStep,
  suggestedPn,
} from "../src/screens/clinical-report/model.ts";
import { mockScenes } from "../src/screens/scenes.ts";

afterEach(() => setFakeView(defaultFakeView));

const a1 = scenario.slideOf("P07", "S26-04812", "A1").id;
const excision = scenario.slideOf("P07", "S26-04740", "A1").id;
const data = () => toClinicalReport(a1);

test("the category follows the staging rules of the largest deposit", () => {
  assert.equal(categoryOf(2.1), "macro");
  assert.equal(categoryOf(2), "micro");
  assert.equal(categoryOf(0.21), "micro");
  assert.equal(categoryOf(0.2), "itc");
  const report = sceneReport(data(), "staging");
  assert.equal(largestMm(report.values.deposits), 8);
});

test("nodes positive counts nodes, not deposits, and sets the pN for a macrometastasis", () => {
  const report = sceneReport(data(), "deposits");
  assert.equal(report.values.deposits.length, 4);
  assert.equal(positiveNodes(data(), report.values.deposits), 2);
  assert.equal(suggestedPn(data(), report.values), "pN1a(sn)");
  assert.equal(
    diagnosisOf(data(), report.values),
    "Lymph nodes, sentinel, left axilla, excision: METASTATIC CARCINOMA, macrometastasis, 4 deposits, largest 8.0 mm (2/2).",
  );
  assert.equal(suggestedPn(data(), { ...report.values, category: "micro" }), "pN1mi(sn)");
});

test("a category against the size needs the confirmation", () => {
  const report = sceneReport(data(), "contra");
  assert.deepEqual(
    issuesOf(data(), report).map((issue) => issue.field),
    ["ack"],
  );
  const kept = { ...report, values: { ...report.values, ack: true } };
  assert.deepEqual(issuesOf(data(), kept), []);
});

test("each blocker scene lists what stops the sign-out", () => {
  assert.deepEqual(
    issuesOf(data(), sceneReport(data(), "missing"), true).map((issue) => issue.blockText),
    ["Final diagnosis is empty"],
  );
  assert.deepEqual(
    issuesOf(data(), sceneReport(data(), "unmeasured")).map((issue) => issue.blockText),
    [
      "D1 is not measured yet",
      "The category is not confirmed",
      "Extranodal extension is not picked",
    ],
  );
  assert.deepEqual(issuesOf(data(), sceneReport(data(), "sign"), true), []);
});

test("Tomáš without the right must pick a co-signer", () => {
  setFakeView({ viewer: "TB", firstWeek: false });
  const report = sceneReport(toClinicalReport(a1), "cosign");
  assert.deepEqual(
    issuesOf(toClinicalReport(a1), report, true).map((issue) => issue.field),
    ["cosigner"],
  );
  const sent = sceneReport(toClinicalReport(a1), "sent");
  assert.equal(sent.sent?.to, scenario.people.LM.id);
});

test("a deposit added after a removal never reuses the removed id", () => {
  const report = sceneReport(data(), "deprm");
  assert.equal(report.removed?.deposit.id, "D2");
  assert.equal(nextDepositId(report), "D4");
});

test("the amendment lists what changed between the two versions", () => {
  const report = sceneReport(data(), "amended");
  assert.ok(report.v1);
  assert.deepEqual(amendmentChanges(data(), report.v1, report.values), [
    ["Nodes positive", "1", "2"],
    ["Deposit D4", "none", "0.90 mm, by hand on A2"],
    ["Final diagnosis", null, null],
  ]);
});

test("the excision template has no staging and every scene maps to a step it has", () => {
  const plain = toClinicalReport(excision);
  assert.deepEqual(issuesOf(plain, sceneReport(plain, "nostaging"), true), []);
  for (const scene of mockScenes.creport) assert.ok(sceneStep[scene], scene);
});
