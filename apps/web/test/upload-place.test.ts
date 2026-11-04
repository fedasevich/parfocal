import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sorting } from "@parfocal/api-client";
import { compareSorting, type PlaceInput, sortingRequestOf } from "../src/upload/place.ts";

const record = (path: string, size = 10) => ({ path, size });

const input: PlaceInput = {
  projectId: "p",
  slides: [record("B/S1/A1.svs"), record("B/loose.tif", 0)],
  results: [
    { item: record("B/S1/A1.geojson"), slide: 0, picked: false, left: false },
    { item: record("B/x.png"), slide: 1, picked: true, left: false },
    { item: record("B/gone.png"), slide: null, picked: false, left: true },
  ],
  caseLabels: ["S1", null],
  pair: "auto",
  cases: "names",
};

const agreeing: Sorting = {
  slides: [
    {
      path: "B/S1/A1.svs",
      outcome: "in-case",
      case: { label: "S1", case_id: null },
      rule: "folder",
      duplicate_of: null,
    },
    { path: "B/loose.tif", outcome: "loose", case: null, rule: null, duplicate_of: null },
  ],
  results: [
    {
      path: "B/S1/A1.geojson",
      outcome: "paired",
      slide: { path: "B/S1/A1.svs", slide_id: null },
      rule: "next-to-slide",
      certainty: "sure",
      candidates: [],
    },
    {
      path: "B/x.png",
      outcome: "paired",
      slide: { path: "B/loose.tif", slide_id: null },
      rule: "picked",
      certainty: "sure",
      candidates: [],
    },
  ],
  others: [],
  new_cases: [],
};

test("the sorting request lists slides and kept results, a pick as a decision, and skips empty sizes", () => {
  const request = sortingRequestOf(input);
  assert.deepEqual(
    request.files.map((file) => file.path),
    ["B/S1/A1.svs", "B/loose.tif", "B/S1/A1.geojson", "B/x.png"],
  );
  assert.equal(request.files[1]?.size, undefined);
  assert.deepEqual(request.result_decisions, [{ path: "B/x.png", slide_path: "B/loose.tif" }]);
  assert.equal(request.slide_decisions, undefined);
});

test("the final request carries the browser's case for every slide", () => {
  const request = sortingRequestOf(input, true);
  assert.deepEqual(request.slide_decisions, [
    { path: "B/S1/A1.svs", case: "S1" },
    { path: "B/loose.tif", loose: true },
  ]);
});

test("no difference when the server agrees", () => {
  assert.deepEqual(compareSorting(input, agreeing), []);
});

test("a case or pairing the server sees differently is listed", () => {
  const [first, second] = agreeing.slides;
  const [pairing, picked] = agreeing.results;
  assert.ok(first && second && pairing && picked);
  const server: Sorting = {
    ...agreeing,
    slides: [{ ...first, case: { label: "S2", case_id: null } }, second],
    results: [{ ...pairing, outcome: "unmatched", slide: null }, picked],
  };
  const found = compareSorting(input, server);
  assert.deepEqual(
    found.map((item) => item.path),
    ["B/S1/A1.svs", "B/S1/A1.geojson"],
  );
  assert.equal(found[0]?.server, "Case S2");
  assert.equal(found[1]?.server, "No slide");
});

test("results are not compared when pairing by the ID inside, which only the server can read", () => {
  const server: Sorting = { ...agreeing, results: [] };
  assert.deepEqual(compareSorting({ ...input, pair: "id" }, server), []);
});
