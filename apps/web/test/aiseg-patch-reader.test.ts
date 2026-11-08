import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { cachedFixture, fixturesDir, syntheticDir } from "@parfocal/test-fixtures";
import {
  createDefaultPixelSourceRegistry,
  createPatchReader,
  createWorkerPatchReader,
  type PatchSource,
  type PatchWorker,
  type PixelSource,
  startPatchWorker,
  type WorkerPatchReaderOptions,
} from "@parfocal/viewer-engine";
import { serve } from "../../../packages/viewer-engine/test/pixel-source/serve.ts";
import { writeZarrFixture } from "../../../packages/viewer-engine/test/pixel-source/zarr-fixture.ts";
import {
  createPresetPatchReader,
  type PresetPatch,
  type PresetPatchReader,
} from "../src/aiseg/patch-reader.ts";
import { PATCH_WIDTH_MICRONS, SCALE_PRESET_IDS } from "../src/aiseg/scale-presets.ts";

const zarr = await writeZarrFixture({
  version: 3,
  dtype: "uint8",
  channels: 3,
  width: 1536,
  height: 1024,
  chunk: 128,
  levels: 5,
});
const sparseZarr = await writeZarrFixture({
  version: 2,
  dtype: "uint8",
  channels: 3,
  width: 1536,
  height: 512,
  chunk: 512,
  levels: 2,
  missing: [[0, 0, 1]],
});

const served = await serve({
  "/synthetic": syntheticDir,
  "/cache": fixturesDir(),
  "/zarr": zarr.root,
  "/sparse-zarr": sparseZarr.root,
});

const readers: PresetPatchReader[] = [];

after(async () => {
  for (const reader of readers) reader.close();
  await served.close();
  await Promise.all([zarr.remove(), sparseZarr.remove()]);
});

function inProcessWorker(): PatchWorker {
  const { port1, port2 } = new MessageChannel();
  startPatchWorker(port2);
  port1.start();
  port2.start();
  return {
    postMessage: (message, transfer) => port1.postMessage(message, transfer),
    addEventListener: (type, listener) =>
      port1.addEventListener(type, listener as unknown as (event: Event) => void),
    terminate: () => port1.close(),
  };
}

function openReader(
  formatId: PixelSource["formatId"],
  path: string,
  extra: Partial<WorkerPatchReaderOptions> = {},
): PresetPatchReader {
  const reader = createPresetPatchReader(
    createWorkerPatchReader({
      request: { formatId, url: served.url(path) },
      spawn: inProcessWorker,
      ...extra,
    }),
  );
  readers.push(reader);
  return reader;
}

function footprintError(read: PresetPatch): number {
  const microns = read.widthMicrons as number;
  return Math.abs(microns - PATCH_WIDTH_MICRONS);
}

interface SlideCase {
  readonly name: string;
  readonly formatId: PixelSource["formatId"];
  readonly path: string | null;
}

const slides: readonly SlideCase[] = [
  {
    name: "Aperio SVS",
    formatId: "aperio-svs",
    path: cachedFixture("CMU-1.svs") === null ? null : "/cache/CMU-1.svs",
  },
  {
    name: "Hamamatsu NDPI",
    formatId: "hamamatsu-ndpi",
    path:
      cachedFixture("CMU-1.ndpi") === null ||
      !createDefaultPixelSourceRegistry().supports("hamamatsu-ndpi")
        ? null
        : "/cache/CMU-1.ndpi",
  },
  { name: "OME-Zarr", formatId: "ome-zarr", path: "/zarr" },
  { name: "generic TIFF", formatId: "generic-tiff", path: "/synthetic/synthetic-jpeg.tiff" },
];

describe("a 128 micron patch from every format", () => {
  for (const slide of slides) {
    const options =
      slide.path === null ? { skip: `${slide.name} fixture or native reader is missing` } : {};
    it(`${slide.name} covers 128 microns at every preset`, options, async () => {
      const reader = openReader(slide.formatId, slide.path as string);
      const info = await reader.ready;
      assert.equal(info.length, SCALE_PRESET_IDS.length);
      for (const preset of SCALE_PRESET_IDS) {
        const plan = await reader.plan(preset);
        assert.ok(plan.sizedByMicrons, `${preset} is sized by microns`);
        const levelMpp = plan.levelMicronsPerPixel as number;
        const read = await reader.read({ preset, x: 4096, y: 4096 });
        assert.equal(read.patch.level, plan.level);
        assert.equal(read.patch.absent, false);
        assert.equal(read.patch.rgb?.length, read.patch.width * read.patch.height * 3);
        if (read.patch.width === plan.patchPixels && read.patch.height === plan.patchPixels) {
          assert.ok(
            footprintError(read) <= levelMpp,
            `${preset} spans ${read.widthMicrons} microns, not 128`,
          );
        }
      }
    });
  }

  it("a 0.5 micron slide reads 256 pixels at level 0 for cells", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    const read = await reader.read({ preset: "cells", x: 768, y: 512 });
    assert.equal(read.patch.level, 0);
    assert.equal(read.patch.width, 256);
    assert.equal(read.patch.height, 256);
    assert.equal(read.widthMicrons, 128);
  });

  it("OME-Zarr patch pixels are the fixture pixels", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    const { patch } = await reader.read({ preset: "cells", x: 768, y: 512 });
    assert.equal(patch.x, 640);
    assert.equal(patch.y, 384);
    const rgb = patch.rgb as Uint8Array;
    for (const [px, py] of [
      [0, 0],
      [100, 37],
      [255, 255],
    ] as const) {
      for (let channel = 0; channel < 3; channel++) {
        assert.equal(
          rgb[(py * patch.width + px) * 3 + channel],
          zarr.value(0, channel, patch.x + px, patch.y + py),
          `pixel ${px},${py} channel ${channel}`,
        );
      }
    }
  });

  it("coarser presets cover the same 128 microns with fewer pixels, and nuclei stop at the finest level", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    const widths = new Map<string, number>();
    for (const preset of SCALE_PRESET_IDS) {
      const read = await reader.read({ preset, x: 768, y: 512 });
      widths.set(preset, read.patch.width);
    }
    assert.deepEqual(
      [...widths],
      [
        ["nuclei", 256],
        ["cells", 256],
        ["tissue", 64],
        ["region", 16],
      ],
    );
  });
});

describe("an NDPI shaped slide", () => {
  const level = (downsample: number) => ({
    downsample,
    width: Math.floor(51200 / downsample),
    height: Math.floor(38144 / downsample),
    tileWidth: 4096,
    tileHeight: 8,
  });
  const ndpiShaped: PatchSource = {
    levels: [1, 2, 4, 8, 16].map(level),
    micronsPerPixel: { x: 0.456, y: 0.456 },
    photometric: "rgb",
    dtype: "uint8",
    getRaster({ window }) {
      const [x0, y0, x1, y1] = window ?? [0, 0, 1, 1];
      const plane = new Uint8Array((x1 - x0) * (y1 - y0)).fill(128);
      return Promise.resolve({
        absent: false,
        width: x1 - x0,
        height: y1 - y0,
        planes: [plane, plane, plane],
      });
    },
  };

  it("reads 128 microns at every preset from a 0.456 micron ladder", async () => {
    const reader = createPresetPatchReader(createPatchReader(ndpiShaped));
    for (const preset of SCALE_PRESET_IDS) {
      const read = await reader.read({ preset, x: 20000, y: 15000 });
      assert.ok(footprintError(read) <= (read.plan.levelMicronsPerPixel as number), preset);
    }
  });
});

describe("cache and edge margin through the worker", () => {
  it("serves a repeat read from the cache", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    const first = await reader.read({ preset: "cells", x: 768, y: 512 });
    const second = await reader.read({ preset: "cells", x: 768, y: 512 });
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.patch.key, first.patch.key);
    assert.deepEqual(second.patch.rgb, first.patch.rgb);
    assert.notEqual(second.patch.rgb?.buffer, first.patch.rgb?.buffer);
    assert.equal(reader.stats().misses, 1);
  });

  it("keeps the patch for a click inside it and moves it for a click near the edge", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    const first = await reader.read({ preset: "cells", x: 768, y: 512 });
    const inside = await reader.read({ preset: "cells", x: 800, y: 540 });
    assert.equal(inside.patch.key, first.patch.key);
    assert.equal(inside.moved, false);
    const nearEdge = await reader.read({
      preset: "cells",
      x: first.patch.x + first.patch.width - 10,
      y: 512,
    });
    assert.equal(nearEdge.moved, true);
    assert.notEqual(nearEdge.patch.key, first.patch.key);
    assert.ok(nearEdge.patch.x > first.patch.x);
    assert.equal(nearEdge.patch.x + 128, first.patch.x + first.patch.width - 10);
  });

  it("clamps the patch at the slide edge and keeps it for a click there", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    const corner = await reader.read({ preset: "cells", x: 3, y: 3 });
    assert.equal(corner.patch.x, 0);
    assert.equal(corner.patch.y, 0);
    const again = await reader.read({ preset: "cells", x: 0, y: 200 });
    assert.equal(again.patch.key, corner.patch.key);
    assert.equal(again.cacheHit, true);
  });

  it("flags a patch inside a missing chunk as absent", async () => {
    const reader = openReader("ome-zarr", "/sparse-zarr");
    const hole = await reader.read({ preset: "cells", x: 768, y: 256 });
    assert.equal(hole.patch.absent, true);
    assert.equal(hole.patch.rgb, null);
    const filled = await reader.read({ preset: "cells", x: 256, y: 256 });
    assert.equal(filled.patch.absent, false);
    assert.ok(filled.patch.rgb);
  });

  it("refuses reads once closed", async () => {
    const reader = openReader("ome-zarr", "/zarr");
    await reader.ready;
    reader.close();
    await assert.rejects(reader.read({ preset: "cells", x: 10, y: 10 }));
  });
});
