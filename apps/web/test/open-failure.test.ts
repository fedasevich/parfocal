import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "@parfocal/api-client";
import { describeOpenFailure } from "../src/viewer/open-failure.ts";

class NamedError extends Error {
  readonly status: number | undefined;
  readonly userMessage: string | undefined;

  constructor(name: string, extra: { status?: number; userMessage?: string } = {}) {
    super(name);
    this.name = name;
    this.status = extra.status;
    this.userMessage = extra.userMessage;
  }
}

test("a missing slide file says the slide may still be processing", () => {
  const failure = describeOpenFailure(new ApiError("not-found", 404));
  assert.equal(failure.title, "The slide file is not available");
  assert.match(failure.detail, /still be processing/);
});

test("a refused read from the edge says access may have changed", () => {
  const failure = describeOpenFailure(new NamedError("SlideBytesError", { status: 403 }));
  assert.equal(failure.title, "You cannot open this slide");
});

test("access that is not configured is told apart from a missing file", () => {
  const failure = describeOpenFailure(new ApiError("server", 503));
  assert.equal(failure.title, "Slide access is not switched on here yet");
});

test("an unsupported format names the format problem and keeps the original safe", () => {
  const failure = describeOpenFailure(new NamedError("UnsupportedFormatError"));
  assert.match(failure.title, /file format cannot be opened/);
  assert.match(failure.detail, /stored safely/);
});

test("a lost graphics context shows the engine's own message", () => {
  const failure = describeOpenFailure(
    new NamedError("GpuUnrecoverableError", { userMessage: "Reload the page." }),
  );
  assert.equal(failure.detail, "Reload the page.");
});

test("anything else gets the generic message without the raw error text", () => {
  const failure = describeOpenFailure(new Error("boom at /tiles/abc"));
  assert.equal(failure.title, "This slide could not be opened");
  assert.doesNotMatch(`${failure.title} ${failure.detail}`, /boom|tiles/);
  assert.equal(describeOpenFailure("odd").title, "This slide could not be opened");
});
