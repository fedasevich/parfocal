import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bandOrder,
  type TissueSpot,
  tissueOrder,
  tourLength,
} from "../src/screens/review/strip-order.ts";

const near: TissueSpot[] = [
  { object: "A", x: 100, y: 100 },
  { object: "B", x: 160, y: 110 },
  { object: "C", x: 220, y: 90 },
];
const far: TissueSpot[] = [
  { object: "D", x: 5000, y: 5000 },
  { object: "E", x: 5060, y: 5010 },
  { object: "F", x: 5120, y: 4990 },
];

test("a cluster is finished before the strip leaves for the next one", () => {
  const mixed = [far[0], near[0], far[1], near[1], far[2], near[2]].flatMap((spot) =>
    spot === undefined ? [] : [spot],
  );
  assert.deepEqual(tissueOrder(mixed), ["A", "B", "C", "D", "E", "F"]);
});

test("the order starts at the top left and walks to the nearest cell", () => {
  assert.deepEqual(tissueOrder([...near].reverse()), ["A", "B", "C"]);
});

test("the same sample gives the same order however it is served", () => {
  const spots = Array.from({ length: 40 }, (_, index) => ({
    object: `C${index}`,
    x: (index * 7919) % 3000,
    y: (index * 104729) % 2000,
  }));
  const forward = tissueOrder(spots);
  assert.deepEqual(tissueOrder([...spots].reverse()), forward);
  assert.deepEqual([...forward].sort(), spots.map((spot) => spot.object).sort());
  const served = spots.map((spot) => spot.object);
  assert.ok(tourLength(forward, spots) < tourLength(served, spots) / 2);
});

test("a very large sample falls back to bands that snake across the slide", () => {
  const rows: TissueSpot[] = [
    { object: "A", x: 10, y: 10 },
    { object: "B", x: 900, y: 20 },
    { object: "C", x: 880, y: 2100 },
    { object: "D", x: 30, y: 2200 },
  ];
  assert.deepEqual(bandOrder(rows), ["A", "B", "C", "D"]);
});

test("no cells give an empty order and one cell gives itself", () => {
  assert.deepEqual(tissueOrder([]), []);
  assert.deepEqual(tissueOrder([{ object: "A", x: 1, y: 1 }]), ["A"]);
});
