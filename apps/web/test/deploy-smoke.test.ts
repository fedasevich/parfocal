import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apiFailed,
  blocksWrite,
  countsAsConsoleError,
  isApiCall,
  report,
  sameOrigin,
} from "../smoke/watch.ts";

const app = "https://app.parfocal.eu";

test("only calls to the app's own /api count as API calls", () => {
  assert.equal(isApiCall(`${app}/api/projects`, app), true);
  assert.equal(isApiCall(`${app}/api`, app), true);
  assert.equal(isApiCall(`${app}/apiary`, app), false);
  assert.equal(isApiCall(`${app}/projects/p1`, app), false);
  assert.equal(isApiCall("https://parfocal-iqcyh5.eu1.zitadel.cloud/api/x", app), false);
  assert.equal(sameOrigin("not a url", app), false);
});

test("every write to the API is blocked except signing in", () => {
  assert.equal(blocksWrite("GET", `${app}/api/projects`, app), false);
  assert.equal(blocksWrite("HEAD", `${app}/api/projects`, app), false);
  assert.equal(blocksWrite("post", `${app}/api/projects/p1/archive`, app), true);
  assert.equal(blocksWrite("PATCH", `${app}/api/projects/p1`, app), true);
  assert.equal(blocksWrite("DELETE", `${app}/api/annotations/a1`, app), true);
  assert.equal(blocksWrite("POST", `${app}/api/auth/sign-in`, app), false);
  assert.equal(blocksWrite("POST", "https://eu.posthog.com/e", app), false);
});

test("a 401 is expected only while signed out", () => {
  assert.equal(apiFailed(401, true), false);
  assert.equal(apiFailed(401, false), true);
  assert.equal(apiFailed(500, true), true);
  assert.equal(apiFailed(404, false), true);
  assert.equal(apiFailed(204, false), false);
});

test("resource load lines are left to the network watch", () => {
  assert.equal(
    countsAsConsoleError("Failed to load resource: the server responded with 401"),
    false,
  );
  assert.equal(countsAsConsoleError("TypeError: x is undefined"), true);
});

test("the report names each problem and where it happened", () => {
  assert.equal(report([]), "no problems");
  assert.equal(
    report([{ kind: "api", where: "home", detail: "GET /api/me answered 500" }]),
    "api on home: GET /api/me answered 500",
  );
});
