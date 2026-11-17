import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkCells, setRegions, summaryCells } from "../src/viewer/stage-geometry.ts";

test("each summary row becomes a cell dot at its centre with its score", () => {
  const summary = {
    count: 2,
    x: new Float32Array([100, 400]),
    y: new Float32Array([200, 50]),
    diagonal: new Uint16Array([10, 0]),
    score: new Uint8Array([255, 0]),
  };
  const cells = summaryCells("set", summary);
  assert.deepEqual(
    cells.map((cell) => [cell.id, cell.kind, cell.score]),
    [
      ["set:0", "cell", 1],
      ["set:1", "cell", 0],
    ],
  );
  assert.deepEqual(cells[0]?.ring, [95, 195, 105, 195, 105, 205, 95, 205]);
  assert.deepEqual(cells[1]?.ring.slice(0, 2), [399, 49]);
});

test("loaded chunk cells become class-coloured outlines named by the set's classes", () => {
  const chunk = {
    number: new Uint32Array([7, 9]),
    offsets: new Uint32Array([0, 3, 4]),
    points: new Float32Array([0, 0, 10, 0, 10, 10, 50, 50]),
    score: new Uint8Array([255, 51]),
  };
  const cells = {
    forEachLive: (visit: (rows: typeof chunk, local: number, classIndex: number) => void) => {
      visit(chunk, 0, 1);
      visit(chunk, 1, 0);
    },
  };
  const drawn = chunkCells("set", cells, ["Tumor", "Lymphocyte"]);
  assert.deepEqual(
    drawn.map((cell) => [cell.id, cell.className, cell.score, Array.from(cell.ring)]),
    [["set:7", "other", 1, [0, 0, 10, 0, 10, 10]]],
  );
  assert.equal(chunkCells("set", cells, ["Stroma", "TUMOR"])[0]?.className, "tumor");
});

test("a set's regions keep their outline and take their class colour", () => {
  const regions = setRegions(
    "set",
    [
      { number: 1, class_index: 0, score: 0.5, outline: [0, 0, 9, 0, 9, 9] },
      { number: 2, class_index: null, score: null, outline: [1, 1, 2, 2] },
    ],
    ["Tumor"],
  );
  assert.deepEqual(regions, [
    {
      id: "set:region:1",
      kind: "region",
      ring: [0, 0, 9, 0, 9, 9],
      className: "tumor",
      score: 0.5,
    },
  ]);
});
