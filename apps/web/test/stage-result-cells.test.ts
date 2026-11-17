import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryCells } from "../src/viewer/stage-geometry.ts";

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
