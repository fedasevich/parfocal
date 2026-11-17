import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario, scenarioAdmin } from "../src/fake/index.ts";
import { ApiError, signInWithPassword } from "../src/index.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

after(() => {
  server.close();
  globalThis.fetch = patchedFetch;
});

const secrets = scenarioAdmin.signInSecrets;
const email = scenario.people.LM.email;

const slideTarget = () => {
  const slide = scenario.slideOf("P07", "S26-04812", "A2");
  return `/projects/${scenario.projectByCode("P07").id}/slides/${slide.id}`;
};

const rejection = async (attempt: Promise<unknown>) => {
  try {
    await attempt;
  } catch (error) {
    assert.ok(error instanceof ApiError);
    return error;
  }
  return assert.fail("expected the call to be rejected");
};

test("a password signs in and lands on the return target, a wrong one is unauthenticated", async () => {
  const target = slideTarget();
  const ok = await signInWithPassword({
    email,
    password: secrets.password,
    keep_signed_in: true,
    return_to: target,
  });
  if (ok.status !== 200) return assert.fail("expected a landing");
  assert.equal(ok.data.return_to, target);
  const unsafe = await signInWithPassword({
    email,
    password: secrets.password,
    keep_signed_in: true,
    return_to: "//evil.example",
  });
  if (unsafe.status !== 200) return assert.fail("expected a landing");
  assert.notEqual(unsafe.data.return_to, "//evil.example");
  const wrong = await rejection(
    signInWithPassword({ email, password: "nope", keep_signed_in: true, return_to: null }),
  );
  assert.equal(wrong.kind, "unauthenticated");
  assert.equal(wrong.problem?.code, "invalid-credentials");
});
