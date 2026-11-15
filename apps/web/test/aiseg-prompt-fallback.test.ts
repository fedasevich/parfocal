import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Patch, SamOutputs } from "@parfocal/viewer-engine";
import { createFakeSam } from "../src/aiseg/fake-sam.ts";
import type { PresetPatchQuery } from "../src/aiseg/patch-reader.ts";
import { promptFallback } from "../src/aiseg/prompt-fallback.ts";
import { promptPassOptionsFor } from "../src/aiseg/prompt-pass.ts";
import { clickTile, ringContains, runRegionPass } from "../src/aiseg/region-pass.ts";

const side = 512;
const centres = [
  { x: 80, y: 80 },
  { x: 200, y: 90 },
  { x: 330, y: 120 },
  { x: 120, y: 260 },
  { x: 300, y: 300 },
  { x: 420, y: 420 },
];

function stainedPatch(): Patch {
  const rgb = new Uint8Array(side * side * 3).fill(230);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      if (centres.some((c) => Math.hypot(x - c.x, y - c.y) <= 10)) {
        rgb.fill(70, (y * side + x) * 3, (y * side + x + 1) * 3);
      }
    }
  }
  return {
    key: "stained",
    level: 0,
    downsample: 1,
    x: 0,
    y: 0,
    width: side,
    height: side,
    absent: false,
    rgb,
  };
}

function setup(segmentAll: () => Promise<SamOutputs>) {
  const sam = { ...createFakeSam(), segmentAll };
  const reader = {
    read(_query: PresetPatchQuery) {
      return Promise.resolve({ patch: stainedPatch() });
    },
  };
  return { sam, reader };
}

describe("prompt-pass fallback", () => {
  it("outlines every stained nucleus when the AIS graph fails", async () => {
    let attempts = 0;
    const failures: unknown[] = [];
    const { sam, reader } = setup(() => {
      attempts++;
      return Promise.reject(new Error("The AIS decoder could not load"));
    });
    const found = await runRegionPass({
      tiles: [clickTile({ x: 256, y: 256 }), clickTile({ x: 256, y: 256 })],
      preset: "nuclei",
      reader,
      sam,
      fallback: promptFallback(sam, promptPassOptionsFor(0.25, "fast")),
      onFallback: (error) => failures.push(error),
    });
    assert.equal(attempts, 1);
    assert.equal(failures.length, 1);
    assert.equal(found.length, centres.length * 2);
    for (const centre of centres) {
      assert.ok(found.some((nucleus) => ringContains(nucleus.ring, centre)));
    }
    assert.deepEqual(sam.dropped.length, 2);
    assert.ok(sam.prompts.length >= centres.length * 2);
  });

  it("still fails the pass when the AIS graph fails and no fallback is given", async () => {
    const { sam, reader } = setup(() => Promise.reject(new Error("broken")));
    await assert.rejects(
      runRegionPass({ tiles: [clickTile({ x: 256, y: 256 })], preset: "nuclei", reader, sam }),
      /broken/,
    );
    assert.equal(sam.dropped.length, 1);
  });

  it("does not prompt when the AIS graph answers", async () => {
    const { sam, reader } = setup(() =>
      Promise.resolve({ maps: { dims: [1, 3, 256, 256], data: new Float32Array(3 * 256 * 256) } }),
    );
    await runRegionPass({
      tiles: [clickTile({ x: 256, y: 256 })],
      preset: "nuclei",
      reader,
      sam,
      fallback: promptFallback(sam, promptPassOptionsFor(0.25, "fast")),
    });
    assert.equal(sam.prompts.length, 0);
  });
});
