import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetSlideEdits, scenario } from "../src/fake/index.ts";
import type { CaseDetail, SlideDetail } from "../src/index.ts";
import { ApiError, changeSlideDetails, getCase, reorderCaseSlides } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(resetSlideEdits);

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const caseId = scenario.cases.find((item) => item.label === "S26-04812")?.id ?? "";
const a1 = scenario.slideOf("P07", "S26-04812", "A1");
const a3 = scenario.slideOf("P07", "S26-04812", "A3");

const labels = async () =>
  ((await getCase(caseId)).data as CaseDetail).slides.map((slide) => slide.label);

test("the fake API changes a slide's stain, level and label and keeps the rest", async () => {
  const changed = (await changeSlideDetails(a1.id, { stain: "PAS", level: 2, label: "A1-2" }))
    .data as SlideDetail;
  assert.deepEqual(
    [changed.label, changed.stain, changed.level, changed.block_id],
    ["A1-2", "PAS", 2, null],
  );
  assert.deepEqual(await labels(), ["A1-2", "A2", "A3"]);
});

test("the fake API refuses a label another slide of the case has", async () => {
  await assert.rejects(changeSlideDetails(a1.id, { label: "A2" }), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    return true;
  });
});

test("the fake API reorders a case and puts unlisted slides after the listed ones", async () => {
  const reordered = (await reorderCaseSlides(caseId, { slide_ids: [a3.id] })).data as CaseDetail;
  assert.deepEqual(
    reordered.slides.map((slide) => slide.label),
    ["A3", "A1", "A2"],
  );
  assert.deepEqual(await labels(), ["A3", "A1", "A2"]);
  await assert.rejects(reorderCaseSlides(caseId, { slide_ids: [a3.id, a3.id] }));
});
