import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Patch, SamOutputs } from "@parfocal/viewer-engine";
import { createFakeSam } from "../src/aiseg/fake-sam.ts";
import type { PresetPatchQuery } from "../src/aiseg/patch-reader.ts";
import {
  autoFallback,
  type OutlineTier,
  promptFallback,
  qualityForTier,
} from "../src/aiseg/prompt-fallback.ts";
import {
  promptEnsemblePoints,
  promptPassOptionsFor,
  promptTileOverlapPixels,
} from "../src/aiseg/prompt-pass.ts";
import {
  clickTile,
  planRegionTiles,
  ringContains,
  runRegionPass,
} from "../src/aiseg/region-pass.ts";

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

  it("overlaps the region tiles by at least 96 px at both patch sizes", () => {
    for (const patchPixels of [512, 256]) {
      const plan = {
        preset: "nuclei" as const,
        level: 0,
        levelMicronsPerPixel: 0.25,
        sizedByMicrons: true,
        patchPixels,
        level0Pixels: patchPixels,
      };
      const [first, second] = planRegionTiles({ x: 0, y: 0, width: 2000, height: 10 }, plan);
      assert.ok(first !== undefined && second !== undefined);
      const step = second.centre.x - first.centre.x;
      assert.ok(patchPixels - step >= promptTileOverlapPixels);
    }
  });

  it("counts a stained nucleus on a tile seam once", async () => {
    const spacing = 80;
    const offset = 20;
    const region = { x: 1000, y: 1000, width: 768, height: 768 };
    const nearest = (value: number) => Math.round((value - offset) / spacing) * spacing + offset;
    const inside = (x: number, y: number) => Math.hypot(x - nearest(x), y - nearest(y)) <= 9;
    assert.ok(Math.abs(nearest(region.x + 384) - (region.x + 384)) <= 4);
    const reader = {
      read(query: PresetPatchQuery) {
        const x0 = Math.round(query.x) - 256;
        const y0 = Math.round(query.y) - 256;
        const rgb = new Uint8Array(side * side * 3).fill(230);
        for (let y = 0; y < side; y++) {
          for (let x = 0; x < side; x++) {
            if (inside(x0 + x, y0 + y)) rgb.fill(70, (y * side + x) * 3, (y * side + x + 1) * 3);
          }
        }
        const patch: Patch = {
          key: `${x0}|${y0}`,
          level: 0,
          downsample: 1,
          x: x0,
          y: y0,
          width: side,
          height: side,
          absent: false,
          rgb,
        };
        return Promise.resolve({ patch });
      },
    };
    const sam = {
      ...createFakeSam(),
      segmentAll: () => Promise.reject(new Error("The AIS decoder could not load")),
    };
    const plan = {
      preset: "nuclei" as const,
      level: 0,
      levelMicronsPerPixel: 0.25,
      sizedByMicrons: true,
      patchPixels: side,
      level0Pixels: side,
    };
    const found = await runRegionPass({
      tiles: planRegionTiles(region, plan),
      preset: "nuclei",
      reader,
      sam,
      fallback: promptFallback(sam, promptPassOptionsFor(0.25, "fast")),
    });
    const perAxis = 9;
    const expected = perAxis * perAxis;
    assert.equal(found.length, expected);
    const centres = new Set(
      found.map((nucleus) => `${nearest(nucleus.centroid.x)},${nearest(nucleus.centroid.y)}`),
    );
    assert.equal(centres.size, expected);
  });

  it("follows the outline tier setting, adding the ensemble only in best quality", async () => {
    const runs = new Map<OutlineTier, { found: number; prompts: number }>();
    for (const tier of ["best", "good", "fast"] as const) {
      const { sam, reader } = setup(() =>
        Promise.reject(new Error("The AIS decoder could not load")),
      );
      const found = await runRegionPass({
        tiles: [clickTile({ x: 256, y: 256 })],
        preset: "nuclei",
        reader,
        sam,
        fallback: autoFallback(sam, tier),
      });
      for (const centre of centres) {
        assert.ok(found.some((nucleus) => ringContains(nucleus.ring, centre)));
      }
      runs.set(tier, { found: found.length, prompts: sam.prompts.length });
    }
    assert.equal(qualityForTier("best"), "best");
    assert.equal(qualityForTier("good"), "fast");
    assert.equal(qualityForTier("fast"), "fast");
    const best = runs.get("best");
    const good = runs.get("good");
    const fast = runs.get("fast");
    assert.ok(best !== undefined && good !== undefined && fast !== undefined);
    assert.deepEqual(good, fast);
    assert.equal(best.found, fast.found);
    assert.ok(best.prompts >= fast.prompts + centres.length * promptEnsemblePoints);
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
