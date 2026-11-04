import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetFakeReportLinks } from "../src/fake/index.ts";
import {
  ApiError,
  createReportLink,
  getSharedReport,
  listReportLinks,
  revokeReportLink,
} from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

const rt14 = "00000000-0000-4000-8007-000000000014";

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakeReportLinks());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const gone = (status: number) => (error: unknown) =>
  error instanceof ApiError && error.status === status;

test("a report link opens the report without people or slides until it is revoked", async () => {
  const created = await createReportLink(rt14);
  assert.equal(created.status, 201);
  if (created.status !== 201) return;
  const { id, token, url } = created.data;
  assert.ok(url.endsWith(`/shared-reports/${token}`));
  const shared = await getSharedReport(token);
  assert.equal(shared.status, 200);
  if (shared.status !== 200) return;
  assert.equal(shared.data.task_name, "Round 2 · CAMELYON v1.0");
  assert.ok(shared.data.evaluation.kappa.every((pair) => pair.first.startsWith("Reviewer ")));
  assert.ok(!JSON.stringify(shared.data).includes(rt14));
  const listed = await listReportLinks(rt14);
  assert.deepEqual(
    listed.status === 200 ? listed.data.map((link) => [link.id, link.opened_count]) : [],
    [[id, 1]],
  );
  await revokeReportLink(rt14, id);
  await assert.rejects(getSharedReport(token), gone(410));
});

test("an unknown token finds nothing", async () => {
  await assert.rejects(getSharedReport("no-such-token"), gone(404));
});
