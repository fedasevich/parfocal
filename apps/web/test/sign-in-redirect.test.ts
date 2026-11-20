import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, getGetMeQueryKey } from "@parfocal/api-client";
import {
  endedAfterHours,
  isSignedOut,
  leaveFor,
  loginUrl,
  passwordSignInAvailable,
  redirectPauseMs,
  signedOutRedirect,
  signedOutTarget,
  signInRedirect,
  startNamedLogin,
} from "../src/session/sign-in-redirect.ts";

function fakeBrowser(pathname: string, search = "") {
  const stored = new Map<string, string>();
  const visited: string[] = [];
  return {
    visited,
    location: { pathname, search, assign: (url: string) => void visited.push(url) },
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    },
  };
}

const unauthenticated = new ApiError("unauthenticated", 401);

test("a 401 means signed out unless the session is only locked", () => {
  assert.equal(isSignedOut(unauthenticated), true);
  const locked = new ApiError("unauthenticated", 401, {
    type: "about:blank",
    title: "Locked",
    status: 401,
    code: "session-locked",
  });
  assert.equal(isSignedOut(locked), false);
  assert.equal(isSignedOut(new ApiError("forbidden", 403)), false);
});

test("a signed-out visitor goes to the app's sign-in page with the page to come back to", () => {
  assert.equal(
    signedOutTarget({ pathname: "/projects/p1", search: "?tab=slides" }),
    "/sign-in?return_to=%2Fprojects%2Fp1%3Ftab%3Dslides",
  );
  assert.equal(loginUrl("/"), "/api/auth/login?return_to=%2F");
});

test("a passkey login sends the email in the body and never in our URL", async () => {
  const sent: { url: string; body: string }[] = [];
  const visited: string[] = [];
  const send = (url: string, init: RequestInit) => {
    sent.push({ url, body: typeof init.body === "string" ? init.body : "" });
    return Promise.resolve(
      Response.json({ location: "https://id.test/authorize?login_hint=anna%40lab.test" }),
    );
  };
  await startNamedLogin(
    { returnTo: "/cases", loginHint: " anna@lab.test ", reauth: true },
    (url) => visited.push(url),
    send,
  );
  assert.equal(sent[0]?.url, "/api/auth/login");
  assert.deepEqual(JSON.parse(sent[0]?.body ?? "{}"), {
    return_to: "/cases",
    reauth: true,
    login_hint: "anna@lab.test",
  });
  assert.deepEqual(visited, ["https://id.test/authorize?login_hint=anna%40lab.test"]);
});

test("a failed passkey login falls back to the plain login without the email", async () => {
  const visited: string[] = [];
  const failing = () => Promise.reject(new Error("offline"));
  await startNamedLogin(
    { returnTo: "/", loginHint: "anna@lab.test" },
    (url) => visited.push(url),
    failing,
  );
  assert.deepEqual(visited, ["/api/auth/login?return_to=%2F"]);
});

test("public pages never redirect", () => {
  assert.equal(signedOutTarget({ pathname: "/sign-in", search: "" }), null);
  assert.equal(signedOutTarget({ pathname: "/invite/abc", search: "" }), null);
});

test("native sign-in is used when the API offers it and the hosted login otherwise", async () => {
  const answering = (status: number, data: unknown) => () => Promise.resolve({ status, data });
  assert.equal(await passwordSignInAvailable("off", answering(200, { available: true })), true);
  assert.equal(await passwordSignInAvailable("off", answering(200, { available: false })), false);
  assert.equal(await passwordSignInAvailable("off", answering(500, {})), false);
  const failing = () => Promise.reject(new Error("offline"));
  assert.equal(await passwordSignInAvailable("off", failing), false);
  assert.equal(await passwordSignInAvailable("all", failing), true);
});

test("the home page sends a signed-out visitor to login once, not in a loop", () => {
  const browser = fakeBrowser("/");
  let at = 1_000;
  const redirect = signedOutRedirect(browser, () => at);
  redirect(unauthenticated);
  redirect(unauthenticated);
  assert.deepEqual(browser.visited, ["/sign-in?return_to=%2F"]);
  at += redirectPauseMs;
  redirect(unauthenticated);
  assert.equal(browser.visited.length, 2);
});

test("the answer to who is signed in is left to the session gate", () => {
  const browser = fakeBrowser("/");
  const redirect = signedOutRedirect(browser);
  redirect(unauthenticated, getGetMeQueryKey());
  assert.deepEqual(browser.visited, []);
  redirect(unauthenticated, ["/api/projects"]);
  assert.deepEqual(browser.visited, ["/sign-in?return_to=%2F"]);
});

test("the session gate's redirect says when the pause holds it back", () => {
  const browser = fakeBrowser("/my-work");
  const go = signInRedirect(browser, () => 1_000);
  assert.equal(go(), true);
  assert.equal(go(), false);
  assert.deepEqual(browser.visited, ["/sign-in?return_to=%2Fmy-work"]);
  assert.equal(signInRedirect(fakeBrowser("/sign-in"))(), false);
});

test("leaving for the hosted login never lets the sign-in page render", async () => {
  const visited: string[] = [];
  const left = leaveFor(loginUrl("/"), (url) => void visited.push(url));
  const settled = await Promise.race([left.then(() => true), Promise.resolve(false)]);
  assert.equal(settled, false);
  assert.deepEqual(visited, ["/api/auth/login?return_to=%2F"]);
});

const ended = (current: unknown) =>
  new ApiError("unauthenticated", 401, {
    type: "about:blank",
    title: "Your session ended",
    status: 401,
    code: "session-expired",
    current,
  });

test("a session that ended says after how many hours on the sign-in page", () => {
  assert.equal(endedAfterHours(ended({ session_hours: 8 })), 8);
  assert.equal(endedAfterHours(ended({ session_hours: "8" })), null);
  assert.equal(endedAfterHours(ended(undefined)), null);
  assert.equal(endedAfterHours(unauthenticated), null);
  assert.equal(isSignedOut(ended({ session_hours: 8 })), true);
  const browser = fakeBrowser("/my-work");
  signedOutRedirect(browser)(ended({ session_hours: 8 }));
  assert.deepEqual(browser.visited, ["/sign-in?return_to=%2Fmy-work&ended=8"]);
  const gate = fakeBrowser("/my-work");
  signInRedirect(gate)(ended({ session_hours: 12 }));
  assert.deepEqual(gate.visited, ["/sign-in?return_to=%2Fmy-work&ended=12"]);
});

test("other failures do not redirect", () => {
  const browser = fakeBrowser("/");
  signedOutRedirect(browser)(new ApiError("server", 503));
  assert.deepEqual(browser.visited, []);
});
