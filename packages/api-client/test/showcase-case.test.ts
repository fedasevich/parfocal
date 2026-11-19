import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import {
  defaultFakeView,
  fakeApiHandlers,
  resetFakeCaseReports,
  scenario,
  scenarioClinical,
  setFakeView,
} from "../src/fake/index.ts";
import { getCase, getCaseReport, getSharedReport, listMyCosignRequests } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => {
  setFakeView(defaultFakeView);
  resetFakeCaseReports();
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const showcase = scenario.cases.find(
  (item) => item.label === scenarioClinical.showcaseCase && item.project === "P03",
);
const p03 = scenario.projectByCode("P03").id;

test("the showcase case opens with its three gallery slides", async () => {
  assert.ok(showcase);
  const opened = await getCase(showcase.id);
  assert.equal(opened.status, 200);
  if (opened.status !== 200) return;
  assert.equal(opened.data.label, scenarioClinical.showcaseCase);
  assert.deepEqual(
    opened.data.slides.map((slide) => slide.label),
    ["CMU-1-Small-Region.svs", "CMU-1.ndpi", "Philips-4.tiff"],
  );
});

test("the showcase report opens signed with its one version", async () => {
  assert.ok(showcase);
  const report = await getCaseReport(p03, showcase.id);
  assert.equal(report.status, 200);
  if (report.status !== 200) return;
  assert.equal(report.data.state, "signed");
  assert.equal(report.data.versions.length, 1);
  assert.deepEqual(report.data.blockers, []);
});

test("a co-sign request still waits for Lenka", async () => {
  const asks = await listMyCosignRequests();
  assert.equal(asks.status, 200);
  if (asks.status !== 200) return;
  assert.ok(asks.data.length >= 1);
});

test("the showcase shared report link opens", async () => {
  const shared = await getSharedReport(scenarioClinical.showcaseReportToken);
  assert.equal(shared.status, 200);
  if (shared.status !== 200) return;
  assert.ok(shared.data.task_name.length > 0);
});
