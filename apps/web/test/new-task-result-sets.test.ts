import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResultSet } from "@parfocal/api-client";
import { shortDate } from "../src/screens/new-task/model.ts";
import { groupResultSets, templateFor } from "../src/screens/new-task/result-sets.ts";

const setOf = (id: string, slide: string, changes: Partial<ResultSet> = {}): ResultSet => ({
  id,
  project_id: "p",
  slide_id: slide,
  name: "Tumour detector v1",
  model_version: "v1.0",
  source: "import",
  source_file: "tumour.geojson",
  produced_at: null,
  status: "ready",
  error_code: null,
  cell_count: 0,
  region_count: 4,
  zone_count: 0,
  created_by_user_id: null,
  created_at: "2026-11-16T09:00:00+01:00",
  ...changes,
});

test("one result set per slide groups into one row that pins each slide to its own set", () => {
  const sets = Array.from({ length: 13 }, (_, index) => setOf(`r${index}`, `s${index}`));
  const { choices, groupOf } = groupResultSets(sets);
  assert.equal(choices.length, 1);
  assert.equal(choices[0]?.id, "r0");
  assert.equal(choices[0]?.short, "Tumour v1.0");
  assert.equal(choices[0]?.detail, "Imported 16 Nov from tumour.geojson");
  assert.equal(Object.keys(choices[0]?.slideSets ?? {}).length, 13);
  assert.equal(choices[0]?.slideSets["s7"], "r7");
  assert.equal(groupOf.get("r12"), "r0");
});

test("a different model or version stays its own row", () => {
  const { choices } = groupResultSets([
    setOf("a", "s1"),
    setOf("b", "s2", { name: "PathoSAM", model_version: "v1.2", source: "run" }),
    setOf("c", "s2", { model_version: "v1.1" }),
  ]);
  assert.deepEqual(
    choices.map((choice) => choice.id),
    ["a", "b", "c"],
  );
});

test("a group knows which objects its sets hold", () => {
  const { choices } = groupResultSets([
    setOf("a", "s1"),
    setOf("b", "s2", { region_count: 0, cell_count: 90 }),
  ]);
  assert.deepEqual(choices[0]?.objects, { regions: true, cells: true, zones: false });
});

const templates = [
  { id: "cells", retired: false, preset: { scope: ["cells" as const] } },
  { id: "regions", retired: false, preset: { scope: ["regions" as const] } },
  { id: "both", retired: false, preset: { scope: ["regions" as const, "cells" as const] } },
  { id: "old", retired: true, preset: { scope: ["regions" as const] } },
];

test("the default template is kept when its objects exist in the result", () => {
  const objects = { regions: true, cells: true, zones: false };
  assert.equal(templateFor(templates, "cells", objects), "cells");
});

test("a template that asks for cells gives way to one for regions on a regions result", () => {
  const objects = { regions: true, cells: false, zones: false };
  assert.equal(templateFor(templates, "cells", objects), "regions");
});

test("a template asking for regions and cells stays when the result holds only regions", () => {
  const objects = { regions: true, cells: false, zones: false };
  assert.equal(templateFor(templates, "both", objects), "both");
});

test("the preferred template stays when none fits", () => {
  const objects = { regions: false, cells: false, zones: false };
  assert.equal(templateFor(templates, "cells", objects), "cells");
});

test("the send date reads as day and month of the real timestamp", () => {
  assert.equal(shortDate("2026-11-17T10:00:00+01:00"), "17 Nov");
});
