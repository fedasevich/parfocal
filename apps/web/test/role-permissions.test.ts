import assert from "node:assert/strict";
import { test } from "node:test";
import { permissionMatrix } from "../src/screens/admin/permission-matrix.generated.ts";
import { permissionColumns, permissionRows } from "../src/screens/admin/permission-table.ts";

test("every permission in the matrix has one row in the table, in matrix order", () => {
  const rows = permissionRows();
  assert.deepEqual(
    rows.map((row) => row.key),
    permissionMatrix.map((entry) => entry.key),
  );
  assert.equal(new Set(rows.map((row) => row.key)).size, permissionMatrix.length);
});

test("each row shows the researcher, reviewer and admin rights grants of the matrix", () => {
  const rows = new Map(permissionRows().map((row) => [row.key, row]));
  for (const entry of permissionMatrix) {
    const row = rows.get(entry.key);
    assert.ok(row, entry.key);
    assert.deepEqual(Object.keys(row.grants), [...permissionColumns]);
    assert.equal(row.grants.researcher, entry.researcher);
    assert.equal(row.grants.reviewer, entry.reviewer);
    assert.equal(row.grants.adminRights, entry.adminRights ? "y" : "n");
  }
});

test("reviewing and annotating sit under Reviewer, in their tasks", () => {
  const review = permissionRows().find((row) => row.key === "review");
  assert.equal(review?.grants.reviewer, "o");
  assert.equal(review?.grants.adminRights, "n");
});

test("admin rights add only setup permissions, never project data", () => {
  const added = permissionRows()
    .filter((row) => row.grants.adminRights === "y")
    .map((row) => row.key);
  assert.deepEqual(added, [
    "privacy-mode",
    "manage-people",
    "workspace-settings",
    "integrations",
    "report-templates",
    "audit-log",
  ]);
});
