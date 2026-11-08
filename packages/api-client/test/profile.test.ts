import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, resetFakeProfile } from "../src/fake/index.ts";
import { ApiError, getMe, updateMe } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakeProfile());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const shownName = async () => {
  const response = await getMe();
  return response.status === 200 ? response.data.display_name : null;
};

test("a saved display name comes back from the next getMe", async () => {
  const saved = await updateMe({ display_name: "  Lenka Malá-Nová " });
  assert.equal(saved.status, 200);
  assert.equal(await shownName(), "Lenka Malá-Nová");
});

test("an empty or overlong display name is refused and the old one stays", async () => {
  for (const display_name of ["   ", "x".repeat(201)]) {
    await assert.rejects(
      updateMe({ display_name }),
      (error) => error instanceof ApiError && error.status === 422,
    );
  }
  assert.equal(await shownName(), "Lenka Malá");
});
