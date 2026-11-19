import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  highPowerFailed,
  isTaskGone,
  resultMissingOf,
  signedOffOf,
  stageIssueOf,
} from "../src/viewer/stage-issues.ts";

const calm = { taskGone: false, failedLevels: [], resultMissing: false };

describe("stage issues", () => {
  it("shows nothing when the task, slide and result are fine", () => {
    assert.equal(stageIssueOf(calm), null);
  });

  it("puts a withdrawn task before a failing slide and a missing result", () => {
    assert.equal(
      stageIssueOf({ taskGone: true, failedLevels: [0], resultMissing: true }),
      "withdrawn",
    );
    assert.equal(stageIssueOf({ ...calm, failedLevels: [1], resultMissing: true }), "slidefail");
    assert.equal(stageIssueOf({ ...calm, resultMissing: true }), "noresults");
  });

  it("counts only the two highest magnifications as a slide that cannot be read", () => {
    assert.equal(highPowerFailed([3, 4]), false);
    assert.equal(highPowerFailed([4, 1]), true);
    assert.equal(stageIssueOf({ ...calm, failedLevels: [2, 5] }), null);
  });

  it("finds a missing result only for a slide the task lists without one", () => {
    const slides = [
      { slide_id: "a", result_set_id: null },
      { slide_id: "b", result_set_id: "set" },
    ];
    assert.equal(resultMissingOf(slides, "a"), true);
    assert.equal(resultMissingOf(slides, "b"), false);
    assert.equal(resultMissingOf(slides, "c"), false);
    assert.equal(resultMissingOf(undefined, "a"), false);
  });

  it("treats only a task that is not found as withdrawn", () => {
    assert.equal(isTaskGone({ status: 404 }), true);
    assert.equal(isTaskGone({ status: 403 }), false);
    assert.equal(isTaskGone(null), false);
  });

  it("reads a sign off from the task or from the slide", () => {
    assert.deepEqual(signedOffOf({ signed_off_at: "2026-10-15T16:00:00Z", slides: [] }, "a"), {
      at: "2026-10-15T16:00:00Z",
    });
    assert.deepEqual(
      signedOffOf({ signed_off_at: null, slides: [{ slide_id: "a", state: "signed-off" }] }, "a"),
      { at: null },
    );
    assert.equal(
      signedOffOf({ signed_off_at: null, slides: [{ slide_id: "a", state: "submitted" }] }, "a"),
      null,
    );
    assert.equal(signedOffOf(undefined, "a"), null);
  });
});
