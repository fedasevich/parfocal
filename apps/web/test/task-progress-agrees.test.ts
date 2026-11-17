import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeamReviewer } from "@parfocal/api-client";
import { minutesLeft } from "../src/screens/my-work/review-progress.ts";
import { reviewerDetail } from "../src/screens/team/team-text.ts";

test("a half done task gives the same estimate on My work and on Team", () => {
  const row = {
    status: "behind",
    slides_done: 1,
    slides_assigned: 4,
    minutes_left: 1,
    assigned_at: "2026-11-17T08:00:00Z",
    last_decision_at: "2026-11-17T08:01:00Z",
  } as TeamReviewer;
  assert.equal(minutesLeft(1, 4), 48);
  assert.equal(reviewerDetail(row, "2026-11-17T09:00:00Z"), "3 slides left · about 48 min");
});
