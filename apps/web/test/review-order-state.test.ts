import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import {
  preparingInterval,
  preparingPollMs,
  reviewOrderState,
} from "../src/screens/review/review-order-state.ts";

const conflict = (code: string) =>
  new ApiError("conflict", 409, { type: "about:blank", title: code, status: 409, code });

test("an order still being worked out reads as preparing and is polled", () => {
  const error = conflict("review-order-not-ready");
  assert.equal(reviewOrderState(error), "preparing");
  assert.equal(preparingInterval(error), preparingPollMs);
});

test("a failed order and unreadable result files read as failed and stop polling", () => {
  for (const code of ["review-order-failed", "result-files-missing", "result-files-unreadable"]) {
    assert.equal(reviewOrderState(conflict(code)), "failed");
    assert.equal(preparingInterval(conflict(code)), false);
  }
});

test("no error or another error leaves the order ready", () => {
  assert.equal(reviewOrderState(null), "ready");
  assert.equal(reviewOrderState(new ApiError("not-found", 404)), "ready");
  assert.equal(reviewOrderState(conflict("something-else")), "ready");
  assert.equal(preparingInterval(undefined), false);
});
