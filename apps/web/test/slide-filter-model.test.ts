import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFiltering,
  matchesFilters,
  noFilters,
  noMatchOf,
} from "../src/screens/project/slide-filter-model.ts";

const base = {
  label: "A1",
  file: "tumor_090.tif",
  stain: "H&E",
  case_label: "S26-04769",
  result_sets: [{ id: "rs1" }],
  reviews: [{ state: "submitted" }],
};
const bare = { ...base, label: "B2", file: "node_12.svs", result_sets: [], reviews: [] };
const open = { ...base, label: "C3", reviews: [{ state: "in-review" }] };

test("no filters keep every slide", () => {
  assert.equal(isFiltering(noFilters), false);
  assert.ok([base, bare, open].every((slide) => matchesFilters(slide, noFilters)));
});

test("the search matches slide, file, stain and case, ignoring case", () => {
  assert.ok(matchesFilters(base, { ...noFilters, query: "TUMOR" }));
  assert.ok(matchesFilters(base, { ...noFilters, query: "s26-047" }));
  assert.ok(matchesFilters(base, { ...noFilters, query: "h&e" }));
  assert.ok(!matchesFilters(bare, { ...noFilters, query: "tumor" }));
});

test("the result set filter keeps slides that carry that set", () => {
  assert.ok(matchesFilters(base, { ...noFilters, resultSetId: "rs1" }));
  assert.ok(!matchesFilters(bare, { ...noFilters, resultSetId: "rs1" }));
});

test("needs review keeps slides with a review not yet submitted", () => {
  const filters = { ...noFilters, needsReview: true };
  assert.ok(matchesFilters(open, filters));
  assert.ok(!matchesFilters(base, filters));
  assert.ok(!matchesFilters(bare, filters));
});

test("no results keeps slides without a result set", () => {
  const filters = { ...noFilters, noResults: true };
  assert.ok(matchesFilters(bare, filters));
  assert.ok(!matchesFilters(base, filters));
});

test("one filter with no match names that filter and several filters share one message", () => {
  assert.deepEqual(noMatchOf({ ...noFilters, needsReview: true }, undefined), {
    kind: "needs-review",
  });
  assert.deepEqual(noMatchOf({ ...noFilters, noResults: true }, undefined), { kind: "no-results" });
  assert.deepEqual(noMatchOf({ ...noFilters, query: "  zz " }, undefined), {
    kind: "query",
    query: "zz",
  });
  assert.deepEqual(noMatchOf({ ...noFilters, resultSetId: "rs1" }, "HoVer-Net 2.1"), {
    kind: "result-set",
    name: "HoVer-Net 2.1",
  });
  assert.deepEqual(noMatchOf({ ...noFilters, needsReview: true, noResults: true }, undefined), {
    kind: "several",
  });
});
