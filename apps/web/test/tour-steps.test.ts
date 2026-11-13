import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLastStep,
  offerShows,
  progressAfterNext,
  progressAfterStop,
  resumeIndex,
  tourDone,
  tourLength,
  tourSteps,
} from "../src/help/tour-steps.ts";

const withIds = { projectId: "p1", taskId: "t1" };
const withoutIds = { projectId: undefined, taskId: undefined };

test("the tour has ten steps with distinct ids and plain text", () => {
  assert.equal(tourLength, 10);
  assert.equal(new Set(tourSteps.map((step) => step.id)).size, 10);
  for (const step of tourSteps) {
    assert.ok(step.title.length > 0 && step.text.length > 20, step.id);
    assert.doesNotMatch(step.text, /decision|—|–/i, step.id);
  }
});

test("steps that need a project or task open its page, or stay put without one", () => {
  const routes = tourSteps.map((step) => step.route(withIds));
  assert.deepEqual(routes.slice(1, 3), ["/projects/p1/upload", "/projects/p1"]);
  assert.equal(routes[5], "/tasks/t1/guided");
  assert.equal(routes[9], "/settings/shortcuts");
  const bare = tourSteps.map((step) => step.route(withoutIds));
  assert.equal(bare[1], undefined);
  assert.equal(bare[5], "/my-work");
  assert.equal(bare[0], "/");
});

test("progress only moves forward and finishing marks the tour done", () => {
  assert.equal(progressAfterNext(0, 0), 1);
  assert.equal(progressAfterNext(2, 5), 5);
  assert.equal(progressAfterNext(tourLength - 1, 9), tourLength);
  assert.ok(tourDone(progressAfterNext(tourLength - 1, 9)));
  assert.equal(progressAfterStop(3, 0), 3);
  assert.equal(progressAfterStop(1, 4), 4);
  assert.equal(progressAfterStop(1, tourLength), tourLength);
});

test("a stopped tour resumes where it stopped and a finished one starts again", () => {
  assert.equal(resumeIndex(0), 0);
  assert.equal(resumeIndex(4), 4);
  assert.equal(resumeIndex(tourLength), 0);
  assert.ok(isLastStep(9) && !isLastStep(8));
});

test("the offer shows only to someone who has not started, finished or declined", () => {
  assert.ok(offerShows({ progress: 0 }));
  assert.ok(!offerShows({ progress: 3 }));
  assert.ok(!offerShows({ progress: tourLength }));
});
