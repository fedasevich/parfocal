import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import type { Answer } from "../src/screens/review/review-state.ts";
import { tableColumns, tableCsv, tableRows } from "../src/screens/viewer/object-table-rows.ts";

const region = (object: string, score: number): ReviewObject =>
  ({ object, kind: "region", class_name: "Tumor", score, size_mm: 2.4 }) as ReviewObject;

const objects = [region("T1", 0.91), region("T2", 0.77)];
const agreed: Answer = { value: "agree", raw: "agree", reasons: [], note: null };
const answer = (object: string) => (object === "T2" ? agreed : undefined);
const pathOf = (object: string) => `P1/S1/A1/${object}`;

test("the Score column hides when confidence is hidden", () => {
  const shown = tableColumns({ showScore: true, presetUsed: false });
  const hidden = tableColumns({ showScore: false, presetUsed: false });
  assert.ok(shown.includes("score"));
  assert.ok(!hidden.includes("score"));
});

test("the Preset column shows only when a preset was used", () => {
  assert.ok(!tableColumns({ showScore: true, presetUsed: false }).includes("preset"));
  assert.ok(tableColumns({ showScore: true, presetUsed: true }).includes("preset"));
});

test("a decided row carries the preset it was decided under and an open row does not", () => {
  const rows = tableRows(objects, [], answer, undefined, "Dim slide");
  assert.deepEqual(
    rows.map((row) => row.preset),
    ["", "Dim slide"],
  );
});

test("the CSV has a header and one line per row with full IDs", () => {
  const rows = tableRows(objects, [{ object: "R1", size: "1 mm", note: "Missed" }], answer);
  const columns = tableColumns({ showScore: true, presetUsed: false });
  const lines = tableCsv(rows, columns, pathOf).trimEnd().split("\n");
  assert.equal(lines.length, rows.length + 1);
  assert.equal(lines[0], "ID,Kind,Score,Size,Your decision,Note");
  assert.ok(lines[1]?.startsWith("P1/S1/A1/T1,"));
});

test("the CSV leaves the Score column out when confidence is hidden", () => {
  const rows = tableRows(objects, [], answer);
  const text = tableCsv(rows, tableColumns({ showScore: false, presetUsed: true }), pathOf);
  assert.equal(text.split("\n")[0], "ID,Kind,Size,Your decision,Preset,Note");
  assert.ok(!text.includes("0.91"));
});

test("a CSV cell with a comma or a quote is quoted", () => {
  const rows = tableRows(objects, [{ object: "R1", size: "1 mm", note: 'Edge, "blurry"' }], answer);
  const text = tableCsv(rows, tableColumns({ showScore: true, presetUsed: false }), pathOf);
  assert.ok(text.includes('"edge, ""blurry"""'));
});
