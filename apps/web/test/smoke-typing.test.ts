import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  type CellCollection,
  firstTypeableCell,
  outlinePoints,
  retriesTyping,
  type TypedOutlines,
  typeable,
  typedCellsFile,
  typingProblem,
} from "../smoke/typing.ts";

const square = [
  [10, 10],
  [30, 10],
  [30, 30],
  [10, 30],
  [10, 10],
];

function polygon(ring: number[][]) {
  return { geometry: { type: "Polygon", coordinates: [ring] } };
}

function answered(type: string, count = 1): TypedOutlines {
  return {
    slide_id: "s1",
    typer: "hovernext-typer",
    version: "1",
    calibrated: true,
    outlines: Array.from({ length: count }, () => ({ type, foreground: 0.9 })),
  };
}

test("a closed GeoJSON ring becomes flat x and y pairs without the closing point", () => {
  assert.deepEqual(outlinePoints(square), [10, 10, 30, 10, 30, 30, 10, 30]);
  assert.deepEqual(outlinePoints(square.slice(0, 3)), [10, 10, 30, 10, 30, 30]);
});

test("only rings of three points or more within the typer span are typeable", () => {
  assert.equal(typeable([0, 0, 10, 0]), false);
  assert.equal(typeable([0, 0, 512, 0, 512, 512]), true);
  assert.equal(typeable([0, 0, 513, 0, 513, 10]), false);
});

test("the first polygon small enough for the typer is picked", () => {
  const cells: CellCollection = {
    features: [
      { geometry: { type: "Point", coordinates: [] } },
      polygon([
        [0, 0],
        [900, 0],
        [900, 900],
        [0, 0],
      ]),
      polygon(square),
    ],
  };
  assert.deepEqual(firstTypeableCell(cells), [10, 10, 30, 10, 30, 30, 10, 30]);
  assert.equal(firstTypeableCell({ features: [] }), null);
});

test("the seeded test_065 cells hold an outline the deployed typer accepts", async () => {
  const cells = JSON.parse(await readFile(typedCellsFile, "utf8")) as CellCollection;
  const points = firstTypeableCell(cells);
  assert.notEqual(points, null);
  assert.equal(typeable(points ?? []), true);
});

test("an answer passes only with one outline of a known class for the same slide", () => {
  assert.equal(typingProblem(answered("immune"), "s1"), null);
  assert.equal(typingProblem(answered("immune"), "s2"), "the typer answered for slide s1");
  assert.equal(typingProblem(answered("immune", 2), "s1"), "the typer sent 2 outlines back");
  assert.equal(typingProblem(answered("Tumor"), "s1"), "the typer sent the class Tumor");
  assert.equal(typingProblem(answered("x", 0), "s1"), "the typer sent 0 outlines back");
});

test("only a busy or cold gateway is asked again", () => {
  assert.equal(retriesTyping(503), true);
  assert.equal(retriesTyping(502), true);
  assert.equal(retriesTyping(504), true);
  assert.equal(retriesTyping(422), false);
  assert.equal(retriesTyping(403), false);
});
