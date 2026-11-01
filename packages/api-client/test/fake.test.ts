import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers } from "../src/fake/index.ts";
import { getGetHealthMockHandler } from "../src/generated/api.msw.ts";
import { getHealth, listProjects } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers());

let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

test("a generated handler answers the generated client with data of the real type", async () => {
  const response = await getHealth();
  assert.equal(response.status, 200);
  assert.equal(typeof response.data.status, "string");
});

test("generated list handlers return arrays", async () => {
  const response = await listProjects();
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.data));
});

test("an override replaces the generated fake body", async () => {
  server.use(getGetHealthMockHandler({ status: "fake" }));
  const response = await getHealth();
  assert.deepEqual(response.data, { status: "fake" });
  server.resetHandlers();
});
