import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { countDraftCalls, draftFolder, formatDraftCount } from "./draft-calls.ts";

const fixtures = fileURLToPath(new URL("./fixtures/draft-calls", import.meta.url));

test("counts operations per area across files and split lines", () => {
  const count = countDraftCalls(fixtures);
  assert.deepEqual(count.areas, {
    admin: ["getAdminOverview", "getStorageUsage"],
    team: ["listTeamWorkload", "listReviewerWorkload"],
    other: ["somethingNew"],
  });
  assert.equal(count.total, 5);
});

test("prints each area and the total", () => {
  const text = formatDraftCount(countDraftCalls(fixtures));
  assert.equal(
    text,
    ["draft calls per area", "  admin: 2", "  other: 1", "  team: 2", "  total: 5"].join("\n"),
  );
});

test("every real draft operation belongs to a named area", () => {
  const count = countDraftCalls(draftFolder);
  assert.ok(count.total > 0);
  assert.deepEqual(count.areas.other ?? [], []);
});
