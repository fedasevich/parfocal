import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { defaultFakeView, fakeApiHandlers, scenario, setFakeView } from "../src/fake/index.ts";
import { rt17 } from "../src/fake/scenario-review.ts";
import { taskSlides } from "../src/fake/scenario-task.ts";

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

const readerSlides = taskSlides
  .filter((slide) => slide.sets.some((key) => key === rt17.resultSet))
  .map((slide) => slide.id);
const [firstSlide, secondSlide] = readerSlides;
assert.ok(firstSlide && secondSlide);
const resultSetId = scenario.resultSets.find((set) => set.key === rt17.resultSet)?.id;
assert.ok(resultSetId);

const get = async (path: string) => {
  const response = await fetch(path);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

const objectsOf = (slideId: string) =>
  get(`/api/review-tasks/${rt17.id}/slides/${slideId}/objects`);

test("the result set routes answer 403 ai-hidden while the first read is open", async () => {
  const detail = await get(`/api/result-sets/${resultSetId}`);
  assert.equal(detail.status, 403);
  assert.equal(detail.body["code"], "ai-hidden");
  const summary = await get(`/api/result-sets/${resultSetId}/cell-summary`);
  assert.equal(summary.status, 403);
  assert.equal(summary.body["code"], "ai-hidden");
});

test("no slide shows AI objects while the first read is open", async () => {
  for (const slideId of readerSlides) {
    const objects = await objectsOf(slideId);
    assert.equal(objects.status, 200);
    assert.deepEqual(objects.body["objects"], []);
  }
});

test("another viewer who does not read this task still sees the result set", async () => {
  setFakeView({ viewer: "DH", firstWeek: false });
  const detail = await get(`/api/result-sets/${resultSetId}`);
  assert.notEqual(detail.status, 403);
});

test("after the first read of one slide only that slide shows its objects", async () => {
  const recorded = await fetch(`/api/review-tasks/${rt17.id}/slides/${firstSlide}/first-read`, {
    method: "POST",
  });
  assert.equal(recorded.status, 200);
  const opened = await objectsOf(firstSlide);
  assert.ok((opened.body["objects"] as unknown[]).length > 0);
  const stillHidden = await objectsOf(secondSlide);
  assert.deepEqual(stillHidden.body["objects"], []);
});

test("after every first read the result set routes answer", async () => {
  for (const slideId of readerSlides) {
    await fetch(`/api/review-tasks/${rt17.id}/slides/${slideId}/first-read`, { method: "POST" });
  }
  const detail = await get(`/api/result-sets/${resultSetId}`);
  assert.notEqual(detail.status, 403);
});
