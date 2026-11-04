import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import { cameraFromSearch, cameraToSearch } from "../src/screens/review/camera-search.ts";
import {
  createActivityThrottle,
  idleCheckDue,
  isSessionLocked,
  locksAt,
  reauthUrl,
} from "../src/session/lock-rules.ts";

const locked = new ApiError("unauthenticated", 401, {
  type: "about:blank",
  title: "Your session is locked. Sign in again to continue",
  status: 401,
  code: "session-locked",
});

test("only a 401 with the session-locked code locks the screen", () => {
  assert.equal(isSessionLocked(locked), true);
  assert.equal(isSessionLocked(new ApiError("unauthenticated", 401)), false);
  assert.equal(
    isSessionLocked(
      new ApiError("forbidden", 403, { ...locked.problem, status: 403 } as ApiError["problem"]),
    ),
    false,
  );
  assert.equal(isSessionLocked(new Error("session-locked")), false);
});

test("activity is sent at most once a minute", () => {
  const throttle = createActivityThrottle();
  const sent = [0, 1_000, 59_999, 60_000, 61_000, 130_000].filter((at) => throttle.shouldSend(at));
  assert.deepEqual(sent, [0, 60_000, 130_000]);
});

test("the idle check asks the API once the idle time has passed", () => {
  assert.equal(idleCheckDue(0, 14 * 60_000, 15), false);
  assert.equal(idleCheckDue(0, 15 * 60_000, 15), true);
});

test("unlocking signs in again and returns to the same path and query", () => {
  const url = new URL(reauthUrl("/projects/p7/slides/s1?x=0.25&y=0.5&z=1.2"), "https://x.test");
  assert.equal(url.pathname, "/api/auth/login");
  assert.equal(url.searchParams.get("reauth"), "true");
  assert.equal(url.searchParams.get("return_to"), "/projects/p7/slides/s1?x=0.25&y=0.5&z=1.2");
});

test("sign-in, sign-up and invite pages never lock", () => {
  assert.equal(locksAt("/sign-in"), false);
  assert.equal(locksAt("/invite"), false);
  assert.equal(locksAt("/shared-reports/abc"), false);
  assert.equal(locksAt("/projects/p7/slides/s1"), true);
  assert.equal(locksAt("/sign-inside"), true);
});

test("the camera survives a trip through the search keys", () => {
  const camera = { x: 700, y: 962, scale: 2.5 };
  const search = cameraToSearch("overview", camera);
  assert.deepEqual(search, { x: 0.5, y: 0.5, z: 2.5 });
  assert.deepEqual(cameraFromSearch("overview", search), camera);
  assert.deepEqual(cameraToSearch("hpf", { x: 400, y: 250, scale: 3.5 }), {
    x: 0.25,
    y: 0.25,
    z: 3.5,
  });
  assert.equal(cameraFromSearch("overview", { x: 0.5, y: 0.5 }), null);
  assert.deepEqual(cameraToSearch("overview", { x: -10, y: 5000, scale: 80 }), {
    x: 0,
    y: 1,
    z: 20,
  });
});
