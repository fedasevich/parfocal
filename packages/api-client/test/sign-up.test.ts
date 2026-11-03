import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario, scenarioAdmin } from "../src/fake/index.ts";
import { ApiError, confirmEmail, createAccount, resendEmailCode } from "../src/index.ts";

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

const account = {
  name: "Jana Nováková",
  email: "jana@clinic.example",
  password: "a-fresh-long-passphrase",
  role: "review" as const,
  accepted_terms: true,
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

test("an account is created and a code is sent to the address", async () => {
  const sent = await createAccount(account);
  assert.equal(sent.data.email, account.email);
  assert.equal(sent.data.resend_seconds, secrets.resendSeconds);
});

test("a short, reused or leaked password, a missing name or consent each name their field", async () => {
  const codesOf = async (change: Partial<typeof account>) =>
    (await rejection(createAccount({ ...account, ...change })))
      .fieldErrors()
      .map((item) => item.code);
  assert.deepEqual(await codesOf({ password: "short" }), ["too-short"]);
  assert.deepEqual(await codesOf({ password: secrets.previousPasswords[0] ?? "" }), ["reused"]);
  assert.deepEqual(await codesOf({ password: secrets.leakedPasswords[0] ?? "" }), ["leaked"]);
  assert.deepEqual(await codesOf({ name: "  " }), ["required"]);
  assert.deepEqual(await codesOf({ email: "not-an-email" }), ["invalid-email"]);
  assert.deepEqual(await codesOf({ accepted_terms: false }), ["terms-required"]);
});

test("an address that already has an account is a conflict", async () => {
  const taken = await rejection(createAccount({ ...account, email: scenario.people.LM.email }));
  assert.equal(taken.kind, "conflict");
  assert.equal(taken.problem?.code, "account-exists");
});

test("the right code confirms the address and leads to setup, a wrong one does not", async () => {
  const ok = await confirmEmail({ email: account.email, code: secrets.code });
  assert.equal(ok.data.return_to, "/setup?step=role");
  const wrong = await rejection(confirmEmail({ email: account.email, code: "000000" }));
  assert.equal(wrong.kind, "unauthenticated");
  assert.equal(wrong.problem?.code, "invalid-code");
});

test("a new code can be asked for", async () => {
  const sent = await resendEmailCode({ email: account.email });
  assert.equal(sent.data.email, account.email);
  assert.equal(sent.data.expires_minutes, 30);
});
