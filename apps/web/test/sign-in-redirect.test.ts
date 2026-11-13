import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import {
  isSignedOut,
  loginUrl,
  redirectPauseMs,
  signedOutRedirect,
  signedOutTarget,
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

test("a signed-out visitor goes to the hosted login with the page to come back to", () => {
  assert.equal(
    signedOutTarget({ pathname: "/projects/p1", search: "?tab=slides" }, "off"),
    loginUrl("/projects/p1?tab=slides"),
  );
  assert.equal(loginUrl("/"), "/api/auth/login?return_to=%2F");
});

test("with the fake API the visitor goes to the prototype sign-in page", () => {
  assert.equal(signedOutTarget({ pathname: "/", search: "" }, "all"), "/sign-in?return_to=%2F");
});

test("public pages never redirect", () => {
  assert.equal(signedOutTarget({ pathname: "/sign-in", search: "" }, "off"), null);
  assert.equal(signedOutTarget({ pathname: "/invite/abc", search: "" }, "off"), null);
});

test("the home page sends a signed-out visitor to login once, not in a loop", () => {
  const browser = fakeBrowser("/");
  let at = 1_000;
  const redirect = signedOutRedirect(browser, "off", () => at);
  redirect(unauthenticated);
  redirect(unauthenticated);
  assert.deepEqual(browser.visited, [loginUrl("/")]);
  at += redirectPauseMs;
  redirect(unauthenticated);
  assert.equal(browser.visited.length, 2);
});

test("other failures do not redirect", () => {
  const browser = fakeBrowser("/");
  signedOutRedirect(browser, "off")(new ApiError("server", 503));
  assert.deepEqual(browser.visited, []);
});
