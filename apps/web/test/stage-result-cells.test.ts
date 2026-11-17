import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classPaints,
  fallbackColour,
  fallbackPalette,
  hexToRgba,
} from "../src/viewer/class-paint.ts";
import { chunkCells, setRegions, summaryCells } from "../src/viewer/stage-geometry.ts";
import { classColors } from "../src/viewer/viewer-engine.ts";

const named = (...names: string[]) =>
  classPaints(
    names.map((name, position) => ({ position, name })),
    [],
  );

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
  const drawn = chunkCells("set", cells, named("Tumor", "Lymphocyte"));
  assert.deepEqual(
    drawn.map((cell) => [cell.id, cell.className, cell.score, Array.from(cell.ring)]),
    [["set:7", "other", 1, [0, 0, 10, 0, 10, 10]]],
  );
  assert.deepEqual(drawn[0]?.classColour, fallbackColour("Lymphocyte"));
  assert.equal(chunkCells("set", cells, named("Stroma", "TUMOR"))[0]?.className, "tumor");
});

test("a set's regions keep their outline and take their class colour", () => {
  const regions = setRegions(
    "set",
    [
      { number: 1, class_index: 0, score: 0.5, outline: [0, 0, 9, 0, 9, 9] },
      { number: 2, class_index: null, score: null, outline: [1, 1, 2, 2] },
    ],
    named("Tumor"),
  );
  assert.deepEqual(regions, [
    {
      id: "set:region:1",
      kind: "region",
      ring: [0, 0, 9, 0, 9, 9],
      className: "tumor",
      classColour: classColors.tumor,
      score: 0.5,
    },
  ]);
});

test("set classes take the project colour by class id, then by name, then a stable fallback", () => {
  const project = [
    { id: "c1", name: "Neoplastic", colour: "#112233" },
    { id: "c2", name: "Inflammatory", colour: "#445566" },
  ];
  const paints = classPaints(
    [
      { position: 0, name: "neoplastic", class_id: null },
      { position: 1, name: "Renamed", class_id: "c2" },
      { position: 2, name: "Dead" },
      { position: 3, name: "Stroma" },
    ],
    project,
  );
  assert.deepEqual(
    paints.map((paint) => paint.hex),
    ["#112233", "#445566", paints[2]?.hex, "#6ee7b7"],
  );
  assert.ok(fallbackPalette.some((hex) => hex === paints[2]?.hex));
  assert.deepEqual(classPaints([{ position: 0, name: "dead" }], [])[0]?.hex, paints[2]?.hex);
  assert.equal(paints[3]?.className, "stroma");
  assert.equal(hexToRgba("nope"), null);
});
