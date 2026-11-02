import assert from "node:assert/strict";
import { test } from "node:test";
import { movedIndex, worklistRows } from "../src/screens/worklist-spike/rows.ts";

test("the spike worklist is the same 10,000 rows on every run", () => {
  const first = worklistRows(10_000);
  const second = worklistRows(10_000);
  assert.equal(first.length, 10_000);
  assert.deepEqual(first[9_999], second[9_999]);
  assert.equal(new Set(first.map((row) => row.id)).size, 10_000);
});

test("J and K move one row and stop at both ends", () => {
  assert.equal(movedIndex(0, "j", 10), 1);
  assert.equal(movedIndex(1, "k", 10), 0);
  assert.equal(movedIndex(0, "k", 10), 0);
  assert.equal(movedIndex(9, "j", 10), 9);
  assert.equal(movedIndex(4, "ArrowDown", 10), 5);
  assert.equal(movedIndex(4, "End", 10), 9);
  assert.equal(movedIndex(4, "Home", 10), 0);
  assert.equal(movedIndex(4, "x", 10), undefined);
  assert.equal(movedIndex(0, "j", 0), undefined);
});
