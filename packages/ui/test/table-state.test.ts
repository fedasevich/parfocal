import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextSort,
  pickStateOf,
  sortDirectionOf,
  sortRows,
  togglePick,
  togglePickAll,
} from "../src/lib/table-state.ts";

const rows = [
  { id: "S-10", objects: 31 },
  { id: "S-2", objects: null },
  { id: "S-1", objects: 4 },
  { id: "S-3", objects: 4 },
];

test("a new column sorts ascending first and the same column flips", () => {
  const first = nextSort(null, "objects");
  assert.deepEqual(first, { key: "objects", direction: "ascending" });
  assert.deepEqual(nextSort(first, "objects"), { key: "objects", direction: "descending" });
  assert.deepEqual(nextSort(nextSort(first, "objects"), "objects"), first);
  assert.deepEqual(nextSort(first, "id", "descending"), { key: "id", direction: "descending" });
  assert.equal(sortDirectionOf(first, "objects"), "ascending");
  assert.equal(sortDirectionOf(first, "id"), undefined);
});

test("rows sort by number, keep ties stable and put empty values last both ways", () => {
  const value = (row: (typeof rows)[number], key: "id" | "objects") => row[key];
  const up = sortRows(rows, { key: "objects", direction: "ascending" }, value);
  assert.deepEqual(
    up.map((row) => row.id),
    ["S-1", "S-3", "S-10", "S-2"],
  );
  const down = sortRows(rows, { key: "objects", direction: "descending" }, value);
  assert.deepEqual(
    down.map((row) => row.id),
    ["S-10", "S-1", "S-3", "S-2"],
  );
  const ids = sortRows(rows, { key: "id", direction: "ascending" }, value);
  assert.deepEqual(
    ids.map((row) => row.id),
    ["S-1", "S-2", "S-3", "S-10"],
  );
  assert.notEqual(sortRows(rows, null, value), rows);
});

test("picking rows reports none, some or all and the header toggles them together", () => {
  const ids = ["a", "b", "c"];
  let picked = new Set<string>();
  assert.equal(pickStateOf(picked, ids), "none");
  picked = togglePick(picked, "b");
  assert.equal(pickStateOf(picked, ids), "some");
  picked = togglePickAll(picked, ids);
  assert.equal(pickStateOf(picked, ids), "all");
  picked = togglePickAll(picked, ids);
  assert.equal(pickStateOf(picked, ids), "none");
  assert.equal(pickStateOf(new Set(["z"]), []), "none");
});
