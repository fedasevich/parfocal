import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetFakeResume } from "../src/fake/index.ts";
import { ApiError, getMyHome, setMyResume } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakeResume());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const resume = async () => {
  const response = await getMyHome();
  assert.equal(response.status, 200);
  return response.status === 200 ? response.data.resume : null;
};

test("home resumes from the derived activity until a resume state is stored", async () => {
  const derived = await resume();
  assert.equal(derived?.mode, "guided");
  assert.equal(derived?.camera, null);
  await setMyResume({
    task_id: rt14,
    slide_id: a1,
    mode: "viewer",
    object_id: "T3",
    camera: { x: 0.3, y: 0.4, z: 2 },
  });
  const stored = await resume();
  assert.equal(stored?.task_id, rt14);
  assert.equal(stored?.slide_id, a1);
  assert.equal(stored?.object_id, "T3");
  assert.equal(stored?.mode, "viewer");
  assert.deepEqual(stored?.camera, { x: 0.3, y: 0.4, z: 2 });
  assert.equal(stored?.position, derived?.position);
});

test("a resume state for a task the fake does not know is refused", async () => {
  await assert.rejects(
    setMyResume({ task_id: crypto.randomUUID(), slide_id: a1, mode: "guided" }),
    (error: unknown) => error instanceof ApiError && error.status === 404,
  );
});
