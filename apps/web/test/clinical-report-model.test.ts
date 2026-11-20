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
  documentOf,
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

test("a report with no deposits says so and leaves out an unknown node count", () => {
  const report = sceneReport(data(), "findings");
  const empty = { ...report.values, deposits: [], examined: "" };
  const unknown = { ...data(), case: { ...data().case, examined: null } };
  assert.equal(
    diagnosisOf(unknown, empty),
    "Lymph nodes, sentinel, left axilla, excision: NO METASTATIC CARCINOMA.",
  );
  assert.equal(
    diagnosisOf(data(), { ...empty, examined: "2" }),
    "Lymph nodes, sentinel, left axilla, excision: NO METASTATIC CARCINOMA (0/2).",
  );
});

test("a negative node report with no deposit and no category passes Staging as pN0(sn)", () => {
  const report = sceneReport(data(), "sign");
  const negative = {
    ...report,
    values: { ...report.values, deposits: [], category: null, ack: false },
  };
  assert.deepEqual(
    issuesOf(data(), negative, true).filter((issue) => issue.step === "staging"),
    [],
  );
  assert.equal(suggestedPn(data(), negative.values), "pN0(sn)");
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

test("the signed report leaves out the fields and headings that have nothing in them", () => {
  const empty = {
    ...data(),
    case: { ...data().case, received: "", requested_by: "", clinical_history: "" },
  };
  const report = sceneReport(empty, "signed");
  const document = documentOf(empty, report, "current", (id) => id);
  const labels = document.head.map(([label]) => label);
  assert.ok(!labels.includes("Received"));
  assert.ok(!labels.includes("Requested by"));
  assert.ok(labels.includes("Accession"));
  assert.ok(!document.sections.some((section) => section.title === "Clinical history"));
});
