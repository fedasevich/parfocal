import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewedShare, reviewedShareText } from "../src/screens/project/reviewed-share.ts";

test("the project header counts reviewed slides and says so, not a bare percentage", () => {
  const share = reviewedShare({ slides: 4, reviewed_slides: 1 });
  assert.deepEqual(share, { reviewed: 1, slides: 4 });
  assert.equal(reviewedShareText({ reviewed: 1, slides: 4 }), "1 of 4 slides reviewed");
  assert.equal(reviewedShareText({ reviewed: 1, slides: 1 }), "1 of 1 slide reviewed");
  assert.doesNotMatch(reviewedShareText({ reviewed: 1, slides: 1 }), /%/);
});

test("a project without slides shows no reviewed share and a count never passes the slides", () => {
  assert.equal(reviewedShare({ slides: 0, reviewed_slides: 0 }), null);
  assert.deepEqual(reviewedShare({ slides: 2, reviewed_slides: 5 }), { reviewed: 2, slides: 2 });
});
