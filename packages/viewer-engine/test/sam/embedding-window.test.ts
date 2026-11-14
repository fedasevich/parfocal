import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  embeddingWindow,
  outsideWindowLogit,
  pasteWindowOutputs,
  type SamOutputs,
  samWindowTokens,
  touchesInnerEdge,
} from "../../src/index.ts";

const click = (x: number, y: number) => ({ points: [{ x, y, positive: true }] });

function windowOutputs(
  size: number,
  candidates: number,
  paint: (mask: number, x: number, y: number) => number,
): SamOutputs {
  const lowSide = size * 4;
  const maskSide = size * 16;
  const lowRes = new Float32Array(candidates * lowSide * lowSide);
  const masks = new Float32Array(candidates * maskSide * maskSide);
  for (let mask = 0; mask < candidates; mask++) {
    for (let y = 0; y < lowSide; y++) {
      for (let x = 0; x < lowSide; x++) {
        lowRes[mask * lowSide * lowSide + y * lowSide + x] = paint(mask, x, y);
      }
    }
    for (let y = 0; y < maskSide; y++) {
      for (let x = 0; x < maskSide; x++) {
        masks[mask * maskSide * maskSide + y * maskSide + x] = paint(mask, x / 4, y / 4);
      }
    }
  }
  const scores = new Float32Array(candidates);
  scores[candidates - 1] = 0.5;
  return {
    masks: { dims: [1, candidates, maskSide, maskSide], data: masks },
    low_res_masks: { dims: [1, candidates, lowSide, lowSide], data: lowRes },
    iou_predictions: { dims: [1, candidates], data: scores },
  };
}

describe("embedding window placement", () => {
  it("centres a 32 token window on a click in the middle of the patch", () => {
    assert.deepEqual(embeddingWindow(click(512, 512)), { x: 16, y: 16, size: samWindowTokens });
  });

  it("matches the export check's rounding for a click off the token grid", () => {
    assert.deepEqual(embeddingWindow(click(300, 400)), { x: 3, y: 9, size: 32 });
  });

  it("stays on the grid near the patch corners", () => {
    assert.deepEqual(embeddingWindow(click(5, 1020)), { x: 0, y: 32, size: 32 });
    assert.deepEqual(embeddingWindow(click(1023, 0), { size: 16 }), { x: 48, y: 0, size: 16 });
  });

  it("covers every point and both box corners of the prompt", () => {
    const window = embeddingWindow({
      points: [{ x: 400, y: 400, positive: true }],
      box: { x0: 350, y0: 380, x1: 560, y1: 600 },
    });
    assert.ok(window);
    assert.ok(window.x * 16 <= 350 && (window.x + window.size) * 16 >= 560);
    assert.ok(window.y * 16 <= 380 && (window.y + window.size) * 16 >= 600);
  });

  it("falls back to the full decoder when the prompt is wider than the window allows", () => {
    const wide = {
      points: [
        { x: 100, y: 500, positive: true },
        { x: 600, y: 500, positive: false },
      ],
    };
    assert.equal(embeddingWindow(wide), null);
    assert.equal(embeddingWindow(click(500, 500), { size: 64 }), null);
    assert.equal(embeddingWindow({ points: [] }), null);
  });

  it("falls back when the previous mask reaches outside the window", () => {
    const inside = new Float32Array(256 * 256).fill(-5);
    inside[128 * 256 + 128] = 3;
    assert.notEqual(embeddingWindow({ ...click(512, 512), previousLogits: inside }), null);
    const outside = inside.slice();
    outside[10 * 256 + 10] = 3;
    assert.equal(embeddingWindow({ ...click(512, 512), previousLogits: outside }), null);
  });
});

describe("embedding window outputs", () => {
  it("pastes the window logits into full-size planes at the window origin", () => {
    const window = { x: 8, y: 16, size: 32 };
    const pasted = pasteWindowOutputs(
      windowOutputs(32, 2, (mask) => mask + 1),
      window,
    );
    const low = pasted["low_res_masks"];
    const full = pasted["masks"];
    assert.deepEqual(low?.dims, [1, 2, 256, 256]);
    assert.deepEqual(full?.dims, [1, 2, 1024, 1024]);
    assert.equal(low?.data[64 * 256 + 32], 1);
    assert.equal(low?.data[63 * 256 + 32], outsideWindowLogit);
    assert.equal(low?.data[256 * 256 + (64 + 127) * 256 + 32 + 127], 2);
    assert.equal(low?.data[256 * 256 + (64 + 128) * 256 + 32], outsideWindowLogit);
    assert.equal(full?.data[256 * 1024 + 128], 1);
    assert.equal(full?.data[256 * 1024 + 127], outsideWindowLogit);
    assert.deepEqual([...(pasted["iou_predictions"]?.data ?? [])], [0, 0.5]);
  });

  it("flags a best mask that reaches an inner edge of the window", () => {
    const window = { x: 16, y: 16, size: 32 };
    const centred = windowOutputs(32, 2, (mask, x, y) =>
      mask === 1 && Math.abs(x - 64) < 20 && Math.abs(y - 64) < 20 ? 4 : -4,
    );
    assert.equal(touchesInnerEdge(centred, window), false);
    const spilling = windowOutputs(32, 2, (mask, x) => (mask === 1 && x < 10 ? 4 : -4));
    assert.equal(touchesInnerEdge(spilling, window), true);
  });

  it("ignores a window edge that is also the patch edge and masks that lost on score", () => {
    const spilling = windowOutputs(32, 2, (mask, x, y) =>
      mask === 1 && x < 10 && Math.abs(y - 64) < 20 ? 4 : -4,
    );
    assert.equal(touchesInnerEdge(spilling, { x: 0, y: 16, size: 32 }), false);
    const loser = windowOutputs(32, 2, (mask, x) => (mask === 0 && x < 10 ? 4 : -4));
    assert.equal(touchesInnerEdge(loser, { x: 16, y: 16, size: 32 }), false);
  });
});
