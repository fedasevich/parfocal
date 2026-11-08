import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type CellSource,
  calibratedShares,
  confidenceOf,
  fadeAlpha,
  isUnsureCall,
  isUnsureCell,
  PagedCells,
  rowOfNumber,
} from "../../src/index.ts";
import { syntheticSlide } from "./synthetic.ts";

const classNames = ["tumor", "stroma", "immune", "other"] as const;
const classNameOf = (index: number) => classNames[index] ?? null;

function sourceOf(slide: ReturnType<typeof syntheticSlide>): CellSource {
  return {
    summary: () => Promise.resolve(slide.summary),
    chunk: (index) => Promise.resolve(slide.chunk(index)),
  };
}

function pagedSlide(withProbs = true) {
  return syntheticSlide({ cells: 40_000, classes: 4, verticesPerCell: 8, withProbs });
}

describe("calibrated shares", () => {
  it("keeps bytes at temperature one and softens them above one", () => {
    assert.deepEqual(calibratedShares([200, 55]), [200 / 255, 55 / 255]);
    const [top = 0, second = 0] = calibratedShares([200, 55], 2);
    assert.ok(Math.abs(top - 1 / (1 + (55 / 200) ** 0.5)) < 1e-9);
    assert.ok(Math.abs(top + second - 1) < 1e-9);
  });

  it("names the top class, its share and the runner up", () => {
    const confidence = confidenceOf(new Uint8Array([10, 20, 200, 25, 90, 80, 5, 80]), 1, 4);
    assert.equal(confidence?.topClass, 0);
    assert.equal(confidence?.top, 90 / 255);
    assert.equal(confidence?.second, 80 / 255);
    assert.equal(isUnsureCell(confidence, 0), true);
    assert.equal(confidenceOf(null, 0, 4), null);
    assert.equal(isUnsureCell(null, 1), true);
    assert.equal(isUnsureCell(null, 0), false);
  });
});

describe("paged results keep confidence", () => {
  it("hands every looked up cell the probabilities its chunk carries", async () => {
    const cells = await PagedCells.open(sourceOf(pagedSlide()), { pagedAbove: 0 });
    for (const number of [1, 12_345, 40_000]) {
      const found = await cells.cell(number);
      const row = rowOfNumber(cells.summary, number);
      const fromSummary = cells.summary.probs?.subarray(row * 4, row * 4 + 4);
      assert.deepEqual([...(found?.probs ?? [])], [...(fromSummary ?? [])]);
      assert.deepEqual(found?.confidence, cells.rowConfidence(row));
    }
  });

  it("fades each resident outline by the top probability of its own chunk", async () => {
    const slide = pagedSlide();
    const cells = await PagedCells.open(sourceOf(slide), { pagedAbove: 0 });
    await cells.show([0, 0, 1500, 1500]);
    const outlines = cells.outlines(classNameOf);
    assert.equal(outlines.length, cells.stats().residentCells);
    const [first] = cells.cache.chunks();
    assert.ok(first);
    const expected = confidenceOf(first.probs, 0, 4);
    assert.equal(outlines[0]?.top, expected?.top);
    assert.equal(outlines[0]?.second, expected?.second);
    const alphas = new Set(outlines.map((outline) => fadeAlpha(outline.top).toFixed(2)));
    assert.ok(alphas.size > 20);
  });

  it("lists the unsure cells in a view least sure first without loading a chunk", async () => {
    const requested: number[] = [];
    const slide = pagedSlide();
    const source: CellSource = {
      summary: () => Promise.resolve(slide.summary),
      chunk: (index) => {
        requested.push(index);
        return Promise.resolve(slide.chunk(index));
      },
    };
    const cells = await PagedCells.open(source, { pagedAbove: 0 });
    const view = [2000, 2000, 2600, 2600] as const;
    const unsure = cells.unsureIn(view);
    assert.ok(unsure.length > 0);
    assert.deepEqual(requested, []);
    for (const cell of unsure) {
      assert.ok(cell.x >= view[0] && cell.x < view[2] && cell.y >= view[1] && cell.y < view[3]);
      assert.ok(isUnsureCall(cell.confidence?.top ?? 1, cell.confidence?.second ?? 0));
    }
    const tops = unsure.map((cell) => cell.confidence?.top ?? 0);
    assert.deepEqual(
      tops,
      [...tops].sort((a, b) => a - b),
    );
    const [gone] = unsure;
    assert.ok(gone);
    cells.edits.remove(gone.number);
    assert.equal(
      cells.unsureIn(view).some((cell) => cell.number === gone.number),
      false,
    );
    assert.equal(cells.unsureIn(view, 3).length, 3);
  });

  it("falls back to the stored unsure flag and the score when a result has no probabilities", async () => {
    const cells = await PagedCells.open(sourceOf(pagedSlide(false)), { pagedAbove: 0 });
    const unsure = cells.unsureIn([0, 0, 3000, 3000]);
    assert.ok(unsure.length > 0);
    for (const cell of unsure) assert.equal((cells.summary.flags[cell.row] ?? 0) & 1, 1);
    await cells.show([0, 0, 1000, 1000]);
    const [outline] = cells.outlines(classNameOf);
    assert.equal(outline?.second, 0);
    assert.ok((outline?.top ?? -1) >= 0);
  });
});
