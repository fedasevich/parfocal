import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { Ring } from "../src/annotations/ai-edit.ts";
import { loadClipper } from "../src/annotations/brush.ts";
import { mergeRings, partsOf, splitRing } from "../src/annotations/split-merge.ts";

const box = (left: number, top: number, right: number, bottom: number): Ring => [
  [left, top],
  [right, top],
  [right, bottom],
  [left, bottom],
];

const xs = (ring: Ring) => ring.map(([x]) => x);

describe("split and merge geometry", () => {
  before(loadClipper);

  test("a line fully across a shape splits it into two parts, the larger first", () => {
    const parts = splitRing(
      box(0, 0, 100, 50),
      [
        { x: 60, y: -10 },
        { x: 60, y: 60 },
      ],
      2,
    );
    assert.ok(parts !== null);
    assert.equal(parts.length, 2);
    const [large, small] = parts;
    assert.ok(large !== undefined && small !== undefined);
    assert.ok(Math.max(...xs(large)) <= 59.01);
    assert.ok(Math.min(...xs(small)) >= 60.99);
  });

  test("a line that does not cross the shape splits nothing", () => {
    const parts = splitRing(
      box(0, 0, 100, 50),
      [
        { x: 60, y: -10 },
        { x: 60, y: 20 },
      ],
      2,
    );
    assert.equal(parts, null);
  });

  test("touching shapes merge into one outline and disjoint shapes are refused", () => {
    const merged = mergeRings([box(0, 0, 10, 10), box(5, 0, 20, 10)]);
    assert.ok(merged !== null);
    assert.deepEqual([Math.min(...xs(merged)), Math.max(...xs(merged))], [0, 20]);
    assert.equal(mergeRings([box(0, 0, 10, 10), box(30, 0, 40, 10)]), null);
    assert.equal(mergeRings([box(0, 0, 10, 10)]), null);
  });

  test("the parts of a painted map are its outer rings without holes", () => {
    const hole = [...box(2, 2, 4, 4)].reverse();
    assert.equal(partsOf([box(0, 0, 10, 10), hole]).length, 1);
    assert.equal(partsOf([box(0, 0, 10, 10), box(20, 0, 30, 10)]).length, 2);
  });
});
