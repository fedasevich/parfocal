import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  PATCH_WIDTH_MICRONS,
  planPresetPatch,
  SCALE_PRESET_IDS,
  SCALE_PRESETS,
  selectPresetLevel,
} from "../src/aiseg/scale-presets.ts";

const ladder = (...downsamples: number[]) => downsamples.map((downsample) => ({ downsample }));

const forty = ladder(1, 2, 4, 8, 16, 32, 64);
const twenty = ladder(1, 2, 4, 8, 16, 32);
const sparse = ladder(1, 4, 16, 64);

describe("scale preset constants", () => {
  test("map each preset to the microns per pixel the POC tuned", () => {
    assert.deepEqual(
      SCALE_PRESET_IDS.map((id) => SCALE_PRESETS[id].micronsPerPixel),
      [0.25, 0.5, 2, 8],
    );
  });

  test("patches are 128 microns wide", () => {
    assert.equal(PATCH_WIDTH_MICRONS, 128);
  });
});

describe("level choice by microns per pixel", () => {
  test("a 0.25 slide reads each preset at its own level", () => {
    const base = { x: 0.25, y: 0.25 };
    assert.deepEqual(
      SCALE_PRESET_IDS.map((id) => selectPresetLevel(forty, base, id)),
      [0, 1, 3, 5],
    );
  });

  test("a 0.5 slide reads nuclei at full resolution, as the finest it has", () => {
    const base = { x: 0.5, y: 0.5 };
    assert.deepEqual(
      SCALE_PRESET_IDS.map((id) => selectPresetLevel(twenty, base, id)),
      [0, 0, 2, 4],
    );
  });

  test("the CMU-1 pixel size of 0.499 reads cells at level 0", () => {
    assert.equal(selectPresetLevel(twenty, { x: 0.499, y: 0.499 }, "cells"), 0);
  });

  test("a sparse ladder picks the nearest level on a log scale", () => {
    const base = { x: 0.25, y: 0.25 };
    assert.equal(selectPresetLevel(sparse, base, "nuclei"), 0);
    assert.equal(selectPresetLevel(sparse, base, "cells"), 0);
    assert.equal(selectPresetLevel(sparse, base, "tissue"), 1);
    assert.equal(selectPresetLevel(sparse, base, "region"), 2);
  });

  test("a tie between two levels goes to the finer one", () => {
    const base = { x: 0.25, y: 0.25 };
    assert.equal(selectPresetLevel(ladder(1, 4), base, "cells"), 0);
  });

  test("a slide with no pixel size falls back to fixed downsample factors", () => {
    assert.deepEqual(
      SCALE_PRESET_IDS.map((id) => selectPresetLevel(forty, null, id)),
      [0, 1, 3, 5],
    );
    assert.deepEqual(
      SCALE_PRESET_IDS.map((id) => selectPresetLevel(forty, { x: 0, y: 0 }, id)),
      [0, 1, 3, 5],
    );
  });

  test("a slide with no levels is refused", () => {
    assert.throws(() => selectPresetLevel([], { x: 0.25, y: 0.25 }, "nuclei"), RangeError);
  });
});

describe("patch plan per preset", () => {
  const base = { x: 0.25, y: 0.25 };

  test("nuclei read a 128 micron patch as 512 pixels at level 0", () => {
    const plan = planPresetPatch(forty, base, "nuclei");
    assert.equal(plan.level, 0);
    assert.equal(plan.patchPixels, 512);
    assert.equal(plan.level0Pixels, 512);
    assert.equal(plan.levelMicronsPerPixel, 0.25);
    assert.equal(plan.sizedByMicrons, true);
  });

  test("the same 128 microns is 256 pixels at 0.5 microns per pixel", () => {
    const plan = planPresetPatch(twenty, { x: 0.5, y: 0.5 }, "nuclei");
    assert.equal(plan.level, 0);
    assert.equal(plan.patchPixels, 256);
    assert.equal(plan.level0Pixels, 256);
  });

  test("a coarser level keeps the 128 micron footprint at level 0", () => {
    const plan = planPresetPatch(forty, base, "tissue");
    assert.equal(plan.level, 3);
    assert.equal(plan.levelMicronsPerPixel, 2);
    assert.equal(plan.patchPixels, 64);
    assert.equal(plan.level0Pixels, 512);
  });

  test("every preset covers the same slide area on a clean ladder", () => {
    for (const id of SCALE_PRESET_IDS) {
      assert.equal(planPresetPatch(forty, base, id).level0Pixels, 512, id);
    }
  });

  test("a region patch is 16 pixels wide", () => {
    assert.equal(planPresetPatch(forty, base, "region").patchPixels, 16);
  });

  test("without a pixel size the preset microns size the patch and it is flagged", () => {
    const plan = planPresetPatch(forty, null, "cells");
    assert.equal(plan.level, 1);
    assert.equal(plan.levelMicronsPerPixel, null);
    assert.equal(plan.sizedByMicrons, false);
    assert.equal(plan.patchPixels, 256);
  });
});
