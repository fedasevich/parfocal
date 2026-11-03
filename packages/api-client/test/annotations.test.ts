import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetFakeAnnotations } from "../src/fake/index.ts";
import { createAnnotation, listAnnotations } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakeAnnotations());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const triangle = {
  type: "Polygon" as const,
  coordinates: [
    [
      [10, 10],
      [110, 10],
      [60, 90],
      [10, 10],
    ] as [number, number][],
  ],
};

test("a saved polygon comes back in the slide's list with its geometry", async () => {
  const created = await createAnnotation("slide-a", { kind: "region", geometry: triangle });
  assert.equal(created.status, 201);
  const listed = await listAnnotations("slide-a", { kind: "region" });
  assert.equal(listed.status, 200);
  if (listed.status !== 200 || created.status !== 201) return;
  assert.deepEqual(
    listed.data.map((item) => [item.id, item.code, item.geometry]),
    [[created.data.id, "T+1", triangle]],
  );
});

test("each slide keeps its own annotations", async () => {
  await createAnnotation("slide-a", { kind: "region", geometry: triangle });
  const other = await listAnnotations("slide-b");
  assert.equal(other.status, 200);
  if (other.status === 200) assert.deepEqual(other.data, []);
});
