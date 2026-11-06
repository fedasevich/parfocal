import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeView,
  fakeApiHandlers,
  resetFakeCaseReports,
  scenario,
  scenarioClinical,
  setFakeView,
} from "../src/fake/index.ts";
import {
  addCaseReportDeposit,
  amendCaseReport,
  type CaseReport,
  type CaseReportVersion,
  getCaseReport,
  getCaseReportVersion,
  getClinicalReport,
  getCosignReview,
  removeCaseReportDeposit,
  returnCosignRequest,
  signCaseReport,
  updateCaseReport,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => setFakeView(defaultFakeView));

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const p03 = scenario.projectByCode("P03").id;
const a1 = scenario.slideOf("P07", "S26-04812", "A1").id;

test("Lenka's report of S26-04812 has the sentinel steps and her three deposits", async () => {
  const report = (await getClinicalReport(p03, a1)).data;
  assert.equal(report.case.label, "S26-04812");
  assert.deepEqual(
    report.template.steps.map((step) => step.label),
    ["Findings", "Staging", "Report text", "Sign out"],
  );
  assert.deepEqual(
    report.values.deposits.map((deposit) => [deposit.id, deposit.object_id, deposit.size_mm]),
    [
      ["D1", "T1", "8.0"],
      ["D2", "T2", "6.4"],
      ["D3", "T3", "1.3"],
    ],
  );
  const lenka = report.members.find((member) => member.user_id === scenario.people.LM.id);
  const tomas = report.members.find((member) => member.user_id === scenario.people.TB.id);
  assert.equal(lenka?.covers_case, true);
  assert.equal(tomas?.covers_case, false);
  assert.equal(report.objects.find((object) => object.object_id === "T1")?.ai_size_mm, 7.7);
});

test("Tomáš drafts the same case with D1 at 1.6 mm", async () => {
  setFakeView({ viewer: "TB", firstWeek: false });
  const report = (await getClinicalReport(p03, a1)).data;
  assert.equal(report.author_user_id, scenario.people.TB.id);
  assert.equal(report.values.deposits[0]?.size_mm, "1.6");
});

test("the co-sign request carries Tomáš's values and the AI sizes", async () => {
  const review = (await getCosignReview(p03, a1)).data;
  assert.equal(review.from_user_id, scenario.people.TB.id);
  assert.equal(review.values.deposits[0]?.size_mm, "1.6");
  assert.equal(review.ai.largest_mm, 7.7);
  assert.equal(review.co_signer_covers_case, true);
  assert.equal(scenarioClinical.cosignSent.caseLabel, review.case_label);
});

const [sentinelCase, excisionCase] = scenario.cases
  .filter((item) => item.project === "P03")
  .map((item) => item.id);

beforeEach(() => resetFakeCaseReports());

test("a P03 case without a report opens the sentinel template, the next one the excision template", async () => {
  const sentinel = (await getCaseReport(p03, sentinelCase ?? "")).data as CaseReport;
  assert.deepEqual(sentinel.template.steps, ["findings", "staging", "text", "sign"]);
  assert.equal(sentinel.deposits.length, 3);
  assert.equal(sentinel.staging?.largest_mm, 8);
  assert.equal(sentinel.staging?.suggested_category, "macro");
  const excision = (await getCaseReport(p03, excisionCase ?? "")).data as CaseReport;
  assert.deepEqual(excision.template.steps, ["findings", "text", "sign"]);
  assert.equal(excision.staging, null);
});

test("a deposit by hand joins the list and the largest one sets the suggestion", async () => {
  const caseId = sentinelCase ?? "";
  const slide = scenario.slideOf("P07", "S26-04812", "A2").id;
  const added = (await addCaseReportDeposit(p03, caseId, { slide_id: slide, size_mm: 12 }))
    .data as CaseReport;
  assert.equal(added.deposits.length, 4);
  assert.equal(added.staging?.largest_mm, 12);
  assert.equal(added.deposits.filter((deposit) => deposit.largest).length, 1);
  const first = added.deposits[0];
  const removed = (await removeCaseReportDeposit(p03, caseId, first?.id ?? "")).data as CaseReport;
  assert.equal(removed.deposits.length, 3);
});

test("a category against the size needs its confirmation, then the report signs and amends", async () => {
  const caseId = sentinelCase ?? "";
  const filled = {
    category: "micro" as const,
    nodes_examined: 2,
    extranodal: "absent" as const,
    diagnosis: "Metastatic carcinoma",
  };
  const unconfirmed = (await updateCaseReport(p03, caseId, filled)).data as CaseReport;
  assert.equal(unconfirmed.staging?.confirmed, false);
  assert.ok(unconfirmed.blockers.some((blocker) => blocker.code === "category-not-confirmed"));
  await assert.rejects(signCaseReport(p03, caseId));
  const confirmed = (await updateCaseReport(p03, caseId, { ...filled, confirm_category: true }))
    .data as CaseReport;
  assert.deepEqual(confirmed.blockers, []);
  const signed = (await signCaseReport(p03, caseId)).data as CaseReport;
  assert.equal(signed.state, "signed");
  assert.equal(signed.versions.length, 1);
  const amended = (
    await amendCaseReport(p03, caseId, {
      reason: "Measured again on a deeper level",
      change: { comment: "Deeper level" },
    })
  ).data as CaseReport;
  assert.equal(amended.state, "amended");
  assert.equal(amended.versions.length, 2);
  const first = (await getCaseReportVersion(p03, caseId, 1)).data as CaseReportVersion;
  assert.equal(first.values.comment, null);
});

test("returning a co-sign request answers with its record", async () => {
  const values = (await getClinicalReport(p03, a1)).data.values;
  const returned = (
    await returnCosignRequest({
      projectId: p03,
      slideId: a1,
      data: { note: "Measure across the capsule.", values },
    })
  ).data;
  assert.equal(returned.note, "Measure across the capsule.");
});
