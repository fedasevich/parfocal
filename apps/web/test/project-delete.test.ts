import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deleteBlockers,
  deleteTitle,
  keptNote,
  whatGoes,
} from "../src/screens/project/project-delete-model.ts";

test("the dialog names what leaves the lists and skips what the project lacks", () => {
  assert.deepEqual(whatGoes({ cases: 3, slides: 12, resultSets: 1, tasks: 2 }), [
    "3 cases",
    "12 slides",
    "1 result set",
    "2 review tasks",
  ]);
  assert.deepEqual(whatGoes({ cases: 0, slides: 1, resultSets: 0, tasks: 0 }), ["1 slide"]);
  assert.deepEqual(whatGoes({ cases: 0, slides: 0, resultSets: 0, tasks: 0 }), []);
});

test("the delete stays blocked until the exact name is typed", () => {
  const name = "Sentinel node eval v2";
  assert.deepEqual(deleteBlockers("", name), [`Type ${name} to confirm.`]);
  assert.deepEqual(deleteBlockers("sentinel node eval v2", name), ["The name does not match."]);
  assert.deepEqual(deleteBlockers("Sentinel node eval", name), ["The name does not match."]);
  assert.deepEqual(deleteBlockers(`  ${name} `, name), []);
});

test("the dialog says the project is kept and can be restored", () => {
  assert.equal(deleteTitle("P07"), "Delete P07?");
  assert.match(keptNote, /stay in storage/);
  assert.match(keptNote, /restore/);
});
