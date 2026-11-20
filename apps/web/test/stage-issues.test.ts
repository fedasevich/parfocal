import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  highPowerFailed,
  isWithdrawn,
  nothingFoundOf,
  othersReviewOf,
  resultMissingOf,
  reviewerNamesOf,
  signedOffOf,
  stageIssueOf,
} from "../src/viewer/stage-issues.ts";

const calm = { withdrawn: false, failedLevels: [], unreadable: false, resultMissing: false };

describe("stage issues", () => {
  it("shows nothing when the task, slide and result are fine", () => {
    assert.equal(stageIssueOf(calm), null);
  });

  it("puts a withdrawn task before a failing slide and a missing result", () => {
    assert.equal(
      stageIssueOf({ withdrawn: true, failedLevels: [0], unreadable: true, resultMissing: true }),
      "withdrawn",
    );
    assert.equal(stageIssueOf({ ...calm, failedLevels: [1], resultMissing: true }), "slidefail");
    assert.equal(stageIssueOf({ ...calm, resultMissing: true }), "noresults");
  });

  it("says the AI found nothing only when the result exists and lists no objects", () => {
    assert.equal(stageIssueOf({ ...calm, nothingFound: true }), "nothingfound");
    assert.equal(stageIssueOf({ ...calm, resultMissing: true, nothingFound: true }), "noresults");
    assert.equal(stageIssueOf({ ...calm, withdrawn: true, nothingFound: true }), "withdrawn");
    assert.equal(nothingFoundOf({ objects: [] }), true);
    assert.equal(nothingFoundOf({ objects: [{}] }), false);
    assert.equal(nothingFoundOf(undefined), false);
  });

  it("counts only the two highest magnifications as a slide that cannot be read", () => {
    assert.equal(highPowerFailed([3, 4]), false);
    assert.equal(highPowerFailed([4, 1]), true);
    assert.equal(stageIssueOf({ ...calm, failedLevels: [2, 5] }), null);
  });

  it("shows a slide flagged as unreadable at high power before any tile fails", () => {
    assert.equal(stageIssueOf({ ...calm, unreadable: true, resultMissing: true }), "slidefail");
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

  it("reads a task as withdrawn only from its withdrawn time", () => {
    assert.equal(isWithdrawn({ withdrawn_at: "2026-10-16T09:30:00Z" }), true);
    assert.equal(isWithdrawn({ withdrawn_at: null }), false);
    assert.equal(isWithdrawn({}), false);
    assert.equal(isWithdrawn(undefined), false);
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

  it("gives an empty name for a slide nobody is assigned to, so the notice can say so", () => {
    assert.equal(reviewerNamesOf([], "en"), "");
    assert.equal(reviewerNamesOf(["", " "], "en"), "");
    assert.equal(reviewerNamesOf(["Lenka", "Simona"], "en"), "Lenka and Simona");
    assert.equal(reviewerNamesOf(null, "en"), null);
  });

  it("names the reviewers of a slide only to someone not assigned to it", () => {
    const slides = [
      { slide_id: "a", reviewer_ids: ["lm", "sm"] },
      { slide_id: "b", reviewer_ids: ["dh"] },
    ];
    assert.deepEqual(othersReviewOf(slides, "a", "dh"), ["lm", "sm"]);
    assert.equal(othersReviewOf(slides, "b", "dh"), null);
    assert.equal(othersReviewOf(slides, "a", null), null);
    assert.equal(othersReviewOf(slides, "c", "dh"), null);
    assert.equal(othersReviewOf(undefined, "a", "dh"), null);
  });
});
