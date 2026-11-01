import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeView,
  fakeApiHandlers,
  scenario,
  scenarioClinical,
  setFakeView,
} from "../src/fake/index.ts";
import {
  getClinicalReport,
  getCosignReview,
  listClinicalReports,
  returnCosignRequest,
  sendClinicalReportForCosign,
  signOutClinicalReport,
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
const excision = scenario.slideOf("P07", "S26-04740", "A1").id;

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

test("the excision case has no staging step, and a P03 slide without a report falls back", async () => {
  const report = (await getClinicalReport(p03, excision)).data;
  assert.equal(report.case.label, "S26-04740");
  assert.ok(!report.template.steps.some((step) => step.key === "staging"));
  const other = scenario.slides.find((slide) => slide.project === "P03");
  assert.ok(other);
  assert.equal((await getClinicalReport(p03, other.id)).data.case.label, "S26-04812");
  const rows = (await listClinicalReports(p03)).data;
  assert.deepEqual(
    rows.map((row) => [row.case_label, row.has_staging]),
    [
      ["S26-04812", true],
      ["S26-04740", false],
    ],
  );
  assert.equal(rows[1]?.slide_id, excision);
});

test("the co-sign request carries Tomáš's values and the AI sizes", async () => {
  const review = (await getCosignReview(p03, a1)).data;
  assert.equal(review.from_user_id, scenario.people.TB.id);
  assert.equal(review.values.deposits[0]?.size_mm, "1.6");
  assert.equal(review.ai.largest_mm, 7.7);
  assert.equal(review.co_signer_covers_case, true);
  assert.equal(scenarioClinical.cosignSent.caseLabel, review.case_label);
});

test("signing, sending and returning answer with their records", async () => {
  const values = (await getClinicalReport(p03, a1)).data.values;
  const signed = (
    await signOutClinicalReport({ projectId: p03, slideId: a1, data: { method: "sso", values } })
  ).data;
  assert.equal(signed.version, 1);
  assert.equal(signed.signed_by_user_id, scenario.people.LM.id);
  const sent = (
    await sendClinicalReportForCosign({
      projectId: p03,
      slideId: a1,
      data: { cosigner_user_id: scenario.people.LM.id, values },
    })
  ).data;
  assert.equal(sent.to_user_id, scenario.people.LM.id);
  const returned = (
    await returnCosignRequest({
      projectId: p03,
      slideId: a1,
      data: { note: "Measure across the capsule.", values },
    })
  ).data;
  assert.equal(returned.note, "Measure across the capsule.");
});
