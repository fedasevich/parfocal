import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import {
  nextReviewOrderState,
  pendingOrder,
  preparingInterval,
  preparingPollMs,
  readyEstimate,
  reviewOrderState,
  waitedMinutes,
} from "../src/screens/review/review-order-state.ts";

const conflict = (code: string) =>
  new ApiError("conflict", 409, { type: "about:blank", title: code, status: 409, code });

const preparing = { order: "preparing" } as const;
const ready = { order: "ready" } as const;

test("an answer that says preparing reads as preparing and is polled", () => {
  assert.equal(reviewOrderState(preparing, null), "preparing");
  assert.equal(preparingInterval(preparing, null), preparingPollMs);
  assert.equal(preparingInterval(ready, null), false);
});

test("a failed order and unreadable result files read as failed and stop polling", () => {
  for (const code of ["review-order-failed", "result-files-missing", "result-files-unreadable"]) {
    assert.equal(reviewOrderState(undefined, conflict(code)), "failed");
    assert.equal(preparingInterval(undefined, conflict(code)), false);
  }
});

test("a poll in flight keeps the preparing or failed screen instead of the loader", () => {
  assert.equal(nextReviewOrderState("preparing", preparing, null, true), "preparing");
  assert.equal(nextReviewOrderState("failed", undefined, null, true), "failed");
  assert.equal(nextReviewOrderState("ready", undefined, null, true), "ready");
  assert.equal(nextReviewOrderState("preparing", ready, null, false), "ready");
  assert.equal(
    nextReviewOrderState("preparing", preparing, conflict("review-order-failed"), false),
    "failed",
  );
});

test("no answer, a ready answer or another error leaves the order ready", () => {
  assert.equal(reviewOrderState(undefined, null), "ready");
  assert.equal(reviewOrderState(ready, null), "ready");
  assert.equal(reviewOrderState({}, null), "ready");
  assert.equal(reviewOrderState(undefined, new ApiError("not-found", 404)), "ready");
  assert.equal(reviewOrderState(undefined, conflict("something-else")), "ready");
  assert.equal(preparingInterval(undefined, undefined), false);
});

test("the estimate reads in rounded seconds under a minute and a half, then in minutes", () => {
  assert.equal(readyEstimate(null), null);
  assert.equal(readyEstimate(0), null);
  assert.deepEqual(readyEstimate(12), { unit: "seconds", count: 15 });
  assert.deepEqual(readyEstimate(30), { unit: "seconds", count: 30 });
  assert.deepEqual(readyEstimate(150), { unit: "minutes", count: 3 });
});

test("the wait is counted in whole minutes from when the task was made", () => {
  const made = "2026-11-19T18:00:00Z";
  assert.equal(waitedMinutes(made, Date.parse("2026-11-19T18:00:40Z")), 0);
  assert.equal(waitedMinutes(made, Date.parse("2026-11-19T18:50:10Z")), 50);
  assert.equal(waitedMinutes(undefined, Date.now()), 0);
  assert.equal(waitedMinutes("not a date", Date.now()), 0);
});

test("the tabs show the order state only until the slide's objects arrive", () => {
  assert.equal(pendingOrder("preparing", false), "preparing");
  assert.equal(pendingOrder("failed", false), "failed");
  assert.equal(pendingOrder("preparing", true), null);
  assert.equal(pendingOrder("ready", false), null);
});
