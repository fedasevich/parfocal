import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Patch, SamOutputs } from "@parfocal/viewer-engine";
import { fakeAisMaps as discMaps } from "../src/aiseg/fake-sam.ts";
import type { PresetPatchQuery } from "../src/aiseg/patch-reader.ts";
import {
  clickTile,
  planRegionTiles,
  RegionPassAbortedError,
  type RegionSam,
  ringBounds,
  ringContains,
  runRegionPass,
} from "../src/aiseg/region-pass.ts";
import type { PresetPatchPlan } from "../src/aiseg/scale-presets.ts";

const plan: PresetPatchPlan = {
  preset: "nuclei",
  level: 0,
  levelMicronsPerPixel: 0.25,
  sizedByMicrons: true,
  patchPixels: 512,
  level0Pixels: 512,
};

const spacing = 40;
const radius = 9;

function nucleiNear(patch: Patch): { x: number; y: number; r: number }[] {
  const discs: { x: number; y: number; r: number }[] = [];
  const first = Math.ceil(patch.x / spacing) * spacing;
  const top = Math.ceil(patch.y / spacing) * spacing;
  for (let y = top; y < patch.y + patch.height; y += spacing) {
    for (let x = first; x < patch.x + patch.width; x += spacing) {
      discs.push({ x: x - patch.x - 0.5, y: y - patch.y - 0.5, r: radius });
    }
  }
  return discs;
}

function fakes() {
  let last: Patch | null = null;
  const reads: PresetPatchQuery[] = [];
  const dropped: string[] = [];
  const reader = {
    read(query: PresetPatchQuery) {
      reads.push(query);
      const patch: Patch = {
        key: `${query.x}|${query.y}`,
        level: 0,
        downsample: 1,
        x: Math.round(query.x) - 256,
        y: Math.round(query.y) - 256,
        width: 512,
        height: 512,
        absent: false,
        rgb: new Uint8Array(512 * 512 * 3),
      };
      last = patch;
      return Promise.resolve({ patch });
    },
  };
  const sam: RegionSam = {
    encode() {
      return Promise.resolve({ ms: 1 } as Awaited<ReturnType<RegionSam["encode"]>>);
    },
    segmentAll(): Promise<SamOutputs> {
      if (last === null) return Promise.reject(new Error("no patch"));
      const maps = discMaps(512, 512, nucleiNear(last));
      return Promise.resolve({ maps: { dims: [1, 3, 512, 512], data: maps } });
    },
    drop(id) {
      dropped.push(id);
    },
  };
  return { reader, sam, reads, dropped };
}

describe("region pass", () => {
  it("tiles a region into cores that cover it exactly once", () => {
    const tiles = planRegionTiles({ x: 1000, y: 2000, width: 1000, height: 300 }, plan);
    assert.equal(tiles.length, 3);
    const area = tiles.reduce((sum, tile) => sum + tile.core.width * tile.core.height, 0);
    assert.equal(area, 1000 * 300);
    assert.deepEqual(tiles[0]?.core, { x: 1000, y: 2000, width: 384, height: 300 });
  });

  it("finds every nucleus of a region once across tile seams", async () => {
    const { reader, sam, dropped } = fakes();
    const region = { x: 4000, y: 4000, width: 800, height: 800 };
    const progress: number[] = [];
    const nuclei = await runRegionPass({
      tiles: planRegionTiles(region, plan),
      preset: "nuclei",
      reader,
      sam,
      onProgress: (step) => progress.push(step.done),
    });
    assert.equal(nuclei.length, 20 * 20);
    assert.deepEqual(progress, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(dropped.length, 9);
    for (const nucleus of nuclei) {
      assert.ok(
        Math.abs(nucleus.centroid.x / spacing - Math.round(nucleus.centroid.x / spacing)) < 0.05,
      );
      const bounds = ringBounds(nucleus.ring);
      assert.ok(Math.abs(bounds.width - radius * 2) < 3);
    }
  });

  it("keeps the whole patch under a click", async () => {
    const { reader, sam, reads } = fakes();
    const nuclei = await runRegionPass({
      tiles: [clickTile({ x: 6000, y: 6000 }, plan)],
      preset: "nuclei",
      reader,
      sam,
    });
    assert.equal(reads.length, 1);
    assert.ok(nuclei.length >= 12 * 12);
  });

  it("keeps only nuclei inside a closed selection", async () => {
    const { reader, sam } = fakes();
    const triangle = Float32Array.from([4000, 4000, 4400, 4000, 4000, 4400]);
    const bounds = ringBounds(triangle);
    const nuclei = await runRegionPass({
      tiles: planRegionTiles(bounds, plan),
      preset: "nuclei",
      reader,
      sam,
      keep: (point) => ringContains(triangle, point),
    });
    assert.ok(nuclei.length > 0);
    for (const nucleus of nuclei) assert.ok(nucleus.centroid.x + nucleus.centroid.y < 8400);
  });

  it("stops between tiles when aborted", async () => {
    const { reader, sam } = fakes();
    const controller = new AbortController();
    await assert.rejects(
      runRegionPass({
        tiles: planRegionTiles({ x: 0, y: 0, width: 2000, height: 2000 }, plan),
        preset: "nuclei",
        reader,
        sam,
        signal: controller.signal,
        onTile: () => controller.abort(),
      }),
      RegionPassAbortedError,
    );
  });
});
