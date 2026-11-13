import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import { cellShapes } from "../src/screens/review/slide-geometry.ts";
import { isUnsureCell, nextUnsureCell, zonesOfCells } from "../src/screens/viewer/zone-cells.ts";

const scores = [
  0.35, 0.37, 0.41, 0.43, 0.45, 0.46, 0.46, 0.47, 0.48, 0.48, 0.49, 0.53, 0.54, 0.56, 0.56, 0.56,
  0.57, 0.58, 0.59, 0.59, 0.59, 0.6, 0.6, 0.6, 0.61, 0.61, 0.35, 0.39, 0.4, 0.42, 0.47, 0.48, 0.48,
  0.49, 0.49, 0.49, 0.5, 0.52, 0.53, 0.54, 0.54, 0.56, 0.56, 0.57, 0.57, 0.58, 0.58, 0.59, 0.6, 0.6,
];

const cells: ReviewObject[] = Object.keys(cellShapes)
  .slice(0, scores.length)
  .map((object, index) => ({
    object,
    kind: "cell" as const,
    number: index + 1,
    class_name: "Tumor",
    score: scores[index] ?? 0.5,
    size_mm: null,
    other_class: "Immune",
  }));

test("a cell is unsure when its two best calls are close", () => {
  const at = (score: number) => ({ ...(cells[0] as ReviewObject), score });
  assert.equal(isUnsureCell(at(0.5)), true);
  assert.equal(isUnsureCell(at(0.9)), false);
});

test("zones hold only unsure cells, most contested first", () => {
  const zones = zonesOfCells(cells);
  assert.ok(zones.length > 0);
  for (const zone of zones) {
    assert.ok(zone.cells.every(isUnsureCell));
    const gaps = zone.cells.map((cell) => Math.abs(cell.score - 0.5));
    assert.deepEqual(
      gaps,
      [...gaps].sort((a, b) => a - b),
    );
  }
});

test("the next unsure cell skips decided cells and wraps round", () => {
  const zone = {
    id: "zone-1",
    name: "Tumor or Immune",
    cells: cells.slice(0, 4),
    total: cells.slice(0, 4),
  };
  const [a, b, c, d] = zone.cells.map((cell) => cell.object);
  const open = (object: string) => object !== b;
  assert.equal(nextUnsureCell(zone, a, open), c);
  assert.equal(nextUnsureCell(zone, d, open), a);
  assert.equal(nextUnsureCell(zone, undefined, open), a);
  assert.equal(
    nextUnsureCell(zone, a, () => false),
    undefined,
  );
});
