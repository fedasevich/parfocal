import assert from "node:assert/strict";
import { test } from "node:test";
import {
  categoryTones,
  isTagHeightInSet,
  isTagToneInSet,
  resultSetSources,
  statusTones,
  tagSlots,
} from "../src/lib/tag-sets.ts";

test("status tags have exactly the six tones", () => {
  assert.deepEqual([...statusTones], ["neutral", "accent", "ok", "warn", "bad", "research"]);
});

test("category tags are gray, with one info tone for remote things", () => {
  assert.deepEqual([...categoryTones], ["neutral", "info"]);
});

test("result sets take their tone from their source", () => {
  assert.deepEqual([...resultSetSources], ["imported", "run", "reviewed"]);
});

test("a tone outside the set fails", () => {
  assert.equal(isTagToneInSet("status-tag", "ok"), true);
  assert.equal(isTagToneInSet("status-tag", "purple"), false);
  assert.equal(isTagToneInSet("status-tag", null), false);
  assert.equal(isTagToneInSet("category-tag", "ok"), false);
  assert.equal(isTagToneInSet("result-set-tag", "imported"), true);
  assert.equal(isTagToneInSet("result-set-tag", "ok"), false);
});

test("a height outside the set fails", () => {
  assert.equal(isTagHeightInSet("status-tag", 20), true);
  assert.equal(isTagHeightInSet("status-tag", 24), false);
  assert.equal(isTagHeightInSet("object-id-tag", 20), true);
  assert.equal(isTagHeightInSet("object-id-tag", 28), true);
  assert.equal(isTagHeightInSet("object-id-tag", 22), false);
  assert.equal(isTagHeightInSet("count-badge", 16), true);
  assert.equal(isTagHeightInSet("count-badge", 20), false);
  assert.equal(isTagHeightInSet("filter-chip", 28), true);
});

test("every tag type is covered", () => {
  assert.deepEqual(tagSlots.toSorted(), [
    "category-tag",
    "count-badge",
    "filter-chip",
    "object-id-tag",
    "result-set-tag",
    "status-tag",
  ]);
});
