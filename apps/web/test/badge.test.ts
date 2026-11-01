import assert from "node:assert/strict";
import { test } from "node:test";
import { activeDraftOperations, fakeBadgeLabel } from "../src/fake-api/badge-state.ts";

const query = (meta: Record<string, unknown> | undefined, active = true) => ({
  meta,
  isActive: () => active,
});

test("every screen shows the badge when all calls are fake", () => {
  assert.equal(fakeBadgeLabel("all", []), "Fake data");
});

test("in drafts mode only screens with an active draft query show the badge", () => {
  assert.equal(fakeBadgeLabel("drafts", []), null);
  assert.equal(fakeBadgeLabel("drafts", [query(undefined)]), null);
  assert.equal(fakeBadgeLabel("drafts", [query({ draft: "listMyJobs" }, false)]), null);
  assert.equal(
    fakeBadgeLabel("drafts", [query({ draft: "listMyJobs" }), query(undefined)]),
    "Fake data from drafts: listMyJobs",
  );
});

test("draft operations are listed once each in a stable order", () => {
  assert.deepEqual(
    activeDraftOperations([
      query({ draft: "listMyJobs" }),
      query({ draft: "getTeamWorkload" }),
      query({ draft: "listMyJobs" }),
    ]),
    ["getTeamWorkload", "listMyJobs"],
  );
});
