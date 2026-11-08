import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesLeft, slideSteps, timeLeftText } from "../src/upload/slide-steps.ts";

test("a slide still uploading is on its first step and cannot be opened", () => {
  const steps = slideSteps({ uploaded: false, state: undefined, hasResults: true });
  assert.equal(steps.done, 0);
  assert.equal(steps.running, true);
  assert.equal(steps.openable, false);
  assert.equal(steps.rows.length, 5);
});

test("a slide that waits for a worker has only the upload done and nothing running", () => {
  const steps = slideSteps({
    uploaded: true,
    state: { status: "waiting", step: null },
    hasResults: true,
  });
  assert.equal(steps.done, 1);
  assert.equal(steps.running, false);
});

test("a running slide checks the finished steps and opens once tissue is found", () => {
  const tiles = slideSteps({
    uploaded: true,
    state: { status: "processing", step: "tiles" },
    hasResults: true,
  });
  assert.equal(tiles.done, 1);
  assert.equal(tiles.running, true);
  assert.equal(tiles.openable, false);
  const reading = slideSteps({
    uploaded: true,
    state: { status: "processing", step: "results" },
    hasResults: true,
  });
  assert.equal(reading.done, 3);
  assert.equal(reading.openable, true);
  const placing = slideSteps({
    uploaded: true,
    state: { status: "processing", step: "place" },
    hasResults: true,
  });
  assert.equal(placing.done, 4);
  assert.equal(placing.openable, true);
  assert.equal(placing.finished, false);
});

test("a finished slide has every step done", () => {
  const steps = slideSteps({
    uploaded: true,
    state: { status: "ready", step: null },
    hasResults: true,
  });
  assert.equal(steps.done, steps.rows.length);
  assert.equal(steps.running, false);
  assert.equal(steps.finished, true);
});

test("a slide without results says so in place of reading them", () => {
  const steps = slideSteps({
    uploaded: true,
    state: { status: "ready", step: null },
    hasResults: false,
  });
  assert.equal(steps.rows[3]?.label, "No results");
});

test("a skipped slide has no steps and stays neutral", () => {
  const steps = slideSteps({
    uploaded: true,
    state: { status: "skipped", step: null },
    hasResults: true,
  });
  assert.equal(steps.skipped, true);
  assert.equal(steps.failed, false);
  assert.deepEqual(steps.rows, []);
  assert.equal(steps.running, false);
});

test("a failed slide stops running and keeps the steps it finished", () => {
  const steps = slideSteps({
    uploaded: true,
    state: { status: "failed", step: null },
    hasResults: true,
  });
  assert.equal(steps.failed, true);
  assert.equal(steps.running, false);
  assert.equal(steps.done, 1);
});

test("the time left is rounded up and hidden until there is a rate", () => {
  assert.equal(minutesLeft(0, 100, 10_000), null);
  assert.equal(minutesLeft(10, 100, 1_000), null);
  assert.equal(minutesLeft(100, 100, 10_000), null);
  assert.equal(minutesLeft(50, 100, 60_000), 1);
  assert.equal(minutesLeft(10, 100, 60_000), 9);
  assert.equal(timeLeftText(null), "");
  assert.equal(timeLeftText(3), " · about 3 min left");
});
