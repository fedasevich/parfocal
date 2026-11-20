import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sorting } from "@parfocal/api-client";
import {
  compareSorting,
  duplicatesOf,
  type PlaceInput,
  shortfallOf,
  sortingRequestOf,
} from "../src/upload/place.ts";

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
  duplicates: {},
  heldBack: [],
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
  room: { used_bytes: 0, needed_bytes: 20, allowance_bytes: null },
};

test("an upload is short of storage only when it needs more than the allowance has left", () => {
  const room = (used: number, needed: number, allowance: number | null) => ({
    used_bytes: used,
    needed_bytes: needed,
    allowance_bytes: allowance,
  });
  assert.equal(shortfallOf(null), null);
  assert.equal(shortfallOf(room(900, 500, null)), null);
  assert.equal(shortfallOf(room(400, 600, 1000)), null);
  assert.deepEqual(shortfallOf(room(400, 601, 1000)), { needed: 601, left: 600, allowance: 1000 });
  assert.deepEqual(shortfallOf(room(1200, 1, 1000)), { needed: 1, left: 0, allowance: 1000 });
});

test("the sorting request lists slides and kept results, a pick as a decision, and skips empty sizes", () => {
  const request = sortingRequestOf(input);
  assert.deepEqual(
    request.files.map((file) => file.path),
    ["B/S1/A1.svs", "B/loose.tif", "B/S1/A1.geojson", "B/x.png"],
  );
  assert.equal(request.files[1]?.size, undefined);
  assert.deepEqual(request.result_decisions, [{ path: "B/x.png", slide_path: "B/loose.tif" }]);
  assert.deepEqual(request.slide_decisions, []);
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

test("a duplicate is listed from the server, and the choice goes out as a keep decision", () => {
  const [first, second] = agreeing.slides;
  assert.ok(first && second);
  const server: Sorting = { ...agreeing, slides: [{ ...first, duplicate_of: "slide-1" }, second] };
  assert.deepEqual(duplicatesOf(server), [{ path: "B/S1/A1.svs", of: "slide-1" }]);
  assert.deepEqual(compareSorting(input, server), []);
  assert.deepEqual(
    sortingRequestOf({ ...input, duplicates: { "B/S1/A1.svs": "keep" } }).slide_decisions,
    [{ path: "B/S1/A1.svs", keep: true }],
  );
  assert.deepEqual(
    sortingRequestOf({ ...input, duplicates: { "B/S1/A1.svs": "skip" } }, true)
      .slide_decisions?.[0],
    { path: "B/S1/A1.svs", case: "S1", keep: false },
  );
});
