import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setupServer } from "msw/node";
import { fakeApiHandlers, scenario, scenarioAdmin } from "../src/fake/index.ts";
import {
  ApiError,
  getSignInOptions,
  requestPasswordReset,
  requestSignInLink,
  resetPassword,
  signInWithCode,
  signInWithPassword,
  startSso,
} from "../src/index.ts";

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

test("sign-in options describe the return target, or the demo slide when none is given", async () => {
  const target = slideTarget();
  const given = (await getSignInOptions(target)).data.deep_link;
  assert.equal(given?.path, target);
  assert.equal(given?.slide_label, "A2");
  assert.equal(given?.task_code, null);
  const demo = (await getSignInOptions()).data.deep_link;
  assert.equal(demo?.task_code, scenarioAdmin.signInDeepLink.task);
  assert.equal((await getSignInOptions("/my-work")).data.deep_link, null);
  assert.equal((await getSignInOptions("//evil.example/x")).data.deep_link, null);
});

test("a password signs in and lands on the return target, a wrong one is unauthenticated", async () => {
  const target = slideTarget();
  const ok = await signInWithPassword({
    email,
    password: secrets.password,
    keep_signed_in: true,
    return_to: target,
  });
  assert.equal(ok.data.return_to, target);
  const unsafe = await signInWithPassword({
    email,
    password: secrets.password,
    keep_signed_in: true,
    return_to: "//evil.example",
  });
  assert.notEqual(unsafe.data.return_to, "//evil.example");
  const wrong = await rejection(
    signInWithPassword({ email, password: "nope", keep_signed_in: true, return_to: null }),
  );
  assert.equal(wrong.kind, "unauthenticated");
  assert.equal(wrong.problem?.code, "invalid-credentials");
});

test("a sign-in link is sent and its code works with the right digits", async () => {
  const sent = await requestSignInLink({ email });
  assert.equal(sent.data.email, email);
  assert.equal(sent.data.expires_minutes, secrets.linkMinutes);
  const ok = await signInWithCode({ email, code: secrets.code, return_to: "/my-work" });
  assert.equal(ok.data.return_to, "/my-work");
  const wrong = await rejection(signInWithCode({ email, code: "000000", return_to: null }));
  assert.equal(wrong.problem?.code, "invalid-code");
});

test("single sign-on returns the target", async () => {
  const institution = (await getSignInOptions()).data.institutions[0];
  assert.ok(institution);
  const session = await startSso({ workspace_id: institution.workspace_id, return_to: "/my-work" });
  assert.equal(session.data.return_to, "/my-work");
});

test("a reset checks length, reuse and known leaks", async () => {
  assert.equal((await requestPasswordReset({ email })).data.email, email);
  const codesOf = async (password: string) =>
    (await rejection(resetPassword({ email, password, return_to: null })))
      .fieldErrors()
      .map((item) => item.code);
  assert.deepEqual(await codesOf("short"), ["too-short"]);
  assert.deepEqual(await codesOf(secrets.previousPasswords[0] ?? ""), ["reused"]);
  assert.deepEqual(await codesOf(secrets.leakedPasswords[0] ?? ""), ["leaked"]);
  const ok = await resetPassword({
    email,
    password: "a-fresh-long-passphrase",
    return_to: "/my-work",
  });
  assert.equal(ok.data.return_to, "/my-work");
});
