import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectMember } from "@parfocal/api-client";
import { nobodySignsOut, signOutRows, withRight } from "../src/screens/project/settings-model.ts";

const members: ProjectMember[] = [
  { user_id: "lm", role: "owner", sign_out: "own" },
  { user_id: "sm", role: "reviewer", sign_out: "any" },
  { user_id: "jr", role: "viewer", sign_out: "never" },
];

test("a viewer always shows Never and cannot be changed", () => {
  const rows = signOutRows([{ user_id: "jr", role: "viewer", sign_out: null }]);
  assert.deepEqual(rows, [{ userId: "jr", role: "viewer", right: "never", fixed: true }]);
  assert.deepEqual(withRight(rows, "jr", "any"), rows);
});

test("setting Never for the last member who could sign out raises the warning", () => {
  let rows = signOutRows(members);
  assert.equal(nobodySignsOut(rows), false);
  rows = withRight(rows, "lm", "never");
  assert.equal(nobodySignsOut(rows), false);
  rows = withRight(rows, "sm", "never");
  assert.equal(nobodySignsOut(rows), true);
});
