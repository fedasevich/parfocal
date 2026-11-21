import assert from "node:assert/strict";
import { test } from "node:test";
import type { SignOffSummary } from "@parfocal/api-client";
import { resolvedParts, undecidedObjects } from "../src/screens/sign-off/counts.ts";

const queue = (overrides: Partial<SignOffSummary["queue"]> = {}): SignOffSummary["queue"] => ({
  total: 4,
  resolved: 4,
  by_researcher: 3,
  by_adjudicator: [],
  with_adjudicator: [],
  left_open: [],
  ...overrides,
});

test("the researcher who also adjudicated is counted once as you", () => {
  const parts = resolvedParts(queue({ by_adjudicator: [{ user_id: "me", count: 1 }] }), "me");
  assert.deepEqual(parts, [{ kind: "you", count: 4 }]);
});

test("another adjudicator and objects left open keep their own counts", () => {
  const parts = resolvedParts(
    queue({
      by_researcher: 1,
      by_adjudicator: [{ user_id: "anna", count: 2 }],
      left_open: [{ object: "T5", slide_label: "A1" }],
    }),
    "me",
  );
  assert.deepEqual(parts, [
    { kind: "you", count: 1 },
    { kind: "person", userId: "anna", count: 2 },
    { kind: "left-open", count: 1 },
  ]);
});

test("nobody's share is listed when everything was decided by the adjudicator", () => {
  const parts = resolvedParts(
    queue({ by_researcher: 0, by_adjudicator: [{ user_id: "anna", count: 4 }] }),
    "me",
  );
  assert.deepEqual(parts, [{ kind: "person", userId: "anna", count: 4 }]);
});

test("objects no reviewer decided are counted, and none means no line", () => {
  assert.deepEqual(undecidedObjects({ objects: { total: 17, undecided: 13 } }), {
    undecided: 13,
    total: 17,
  });
  assert.equal(undecidedObjects({ objects: { total: 17, undecided: 0 } }), null);
});
