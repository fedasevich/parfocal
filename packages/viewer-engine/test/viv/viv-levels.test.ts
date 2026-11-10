import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { syntheticDir } from "@parfocal/test-fixtures";
import {
  magnificationAtZoom,
  openOmeZarrSource,
  openTiffSource,
  type PixelLevel,
  type PixelSource,
  readTileIndex,
  zoomForMagnification,
} from "../../src/index.ts";
import {
  boxDownsampleToInterleaved,
  createVivLevels,
  pixelSlide,
  rgbPhotometricInterpretation,
  UnsupportedVivSourceError,
  virtualLadder,
  vivTileSize,
} from "../../src/viv/index.ts";
import { type VivRegion, type VivTile, vivSignalAborted } from "../../src/viv/viv-levels.ts";
import { serve } from "../pixel-source/serve.ts";
import { writeZarrFixture } from "../pixel-source/zarr-fixture.ts";

const sparseZarr = await writeZarrFixture({
  version: 2,
  dtype: "uint8",
  channels: 3,
  width: 512,
  height: 256,
  chunk: 256,
  levels: 1,
  missing: [[0, 0, 1]],
});
const served = await serve({ "/synthetic": syntheticDir, "/sparse.zarr": sparseZarr.root });

after(async () => {
  await Promise.all([served.close(), sparseZarr.remove()]);
});

const open = (file: string, formatId: "generic-tiff" | "ome-tiff") =>
  openTiffSource({ formatId, url: served.url(`/synthetic/${file}`) });

function level(downsample: number, width: number, height: number): PixelLevel {
  return { downsample, width, height, tileWidth: 256, tileHeight: 256 };
}

const cmu1Levels = [level(1, 46_000, 32_914), level(4, 11_500, 8_228), level(16, 2_875, 2_057)];

function filledWith(sample: number) {
  return (region: VivRegion): Promise<VivTile> => {
    const [x0, y0, x1, y1] = region.window;
    const width = x1 - x0;
    const height = y1 - y0;
    assert.ok(width > 0 && height > 0, `the window ${region.window.join(",")} is empty`);
    const plane = new Uint8Array(width * height).fill(sample);
    return Promise.resolve({
      data: boxDownsampleToInterleaved(
        [plane, plane, plane],
        width,
        height,
        region.residual,
        region.width,
        region.height,
      ),
      width: region.width,
      height: region.height,
    });
  };
}

function meanAbsoluteDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  assert.equal(a.length, b.length);
  let total = 0;
  for (let index = 0; index < a.length; index++) {
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return total / a.length;
}

describe("the virtual 2^i ladder", () => {
  it("backs every power of two with the finest real level not finer than it (CMU-1.svs)", () => {
    const ladder = virtualLadder(cmu1Levels, 256);
    assert.deepEqual(
      ladder.map(({ downsample, backing, residual }) => [downsample, backing, residual]),
      [
        [1, 0, 1],
        [2, 0, 2],
        [4, 1, 1],
        [8, 1, 2],
        [16, 2, 1],
        [32, 2, 2],
        [64, 2, 4],
        [128, 2, 8],
        [256, 2, 16],
      ],
    );
    const last = ladder.at(-1);
    assert.deepEqual([last?.width, last?.height], [180, 129]);
    assert.deepEqual(
      [ladder[1]?.width, ladder[1]?.height],
      [23_000, 16_457],
      "virtual sizes round up like the real levels",
    );
  });

  it("refuses a level whose downsample is not a power of two", () => {
    assert.throws(
      () => virtualLadder([level(1, 1000, 1000), level(3, 334, 334)], 256),
      UnsupportedVivSourceError,
    );
  });

  it("uses square source tiles up to 1024 and 512 otherwise", () => {
    assert.equal(vivTileSize({ tileSize: { width: 240, height: 240 } }), 240);
    assert.equal(vivTileSize({ tileSize: { width: 2048, height: 2048 } }), 512);
    assert.equal(vivTileSize({ tileSize: { width: 256, height: 128 } }), 512);
  });
});

describe("box downsampling into interleaved RGB", () => {
  it("averages each block per channel and keeps short edge blocks", () => {
    const red = Uint8Array.from([0, 2, 10, 4, 6, 20]);
    const green = Uint8Array.from([1, 1, 1, 1, 1, 1]);
    const blue = Uint8Array.from([255, 255, 0, 255, 254, 0]);
    const out = boxDownsampleToInterleaved([red, green, blue], 3, 2, 2, 2, 1);
    assert.deepEqual([...out], [3, 1, 255, 15, 1, 0]);
  });

  it("repeats the edge sample when the source is a row or a column short of the output", () => {
    const short = new Uint8Array(4 * 2).fill(200);
    const averaged = boxDownsampleToInterleaved([short, short, short], 4, 2, 2, 3, 2);
    assert.deepEqual([...averaged], new Array(3 * 2 * 3).fill(200));
    const row = Uint8Array.from([10, 20]);
    const copied = boxDownsampleToInterleaved([row, row, row], 2, 1, 1, 3, 2);
    assert.deepEqual(
      [...copied],
      [10, 10, 10, 20, 20, 20, 20, 20, 20, 10, 10, 10, 20, 20, 20, 20, 20, 20],
    );
  });

  it("is a plain interleave at residual 1", () => {
    const planes = [Uint8Array.from([1, 2]), Uint8Array.from([3, 4]), Uint8Array.from([5, 6])];
    assert.deepEqual([...boxDownsampleToInterleaved(planes, 2, 1, 1, 2, 1)], [1, 3, 5, 2, 4, 6]);
  });
});

describe("Viv levels over a PixelSource", () => {
  it("tells Viv the planes are RGB, because the source already converted YCbCr (synthetic-jpeg.tiff)", async () => {
    const ycbcr = await open("synthetic-jpeg.tiff", "generic-tiff");
    const lossless = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      const fromJpeg = createVivLevels(ycbcr);
      const fromLossless = createVivLevels(lossless);
      for (const vivLevel of fromJpeg.levels) {
        assert.equal(vivLevel.meta.photometricInterpretation, rgbPhotometricInterpretation);
        assert.deepEqual(vivLevel.labels, ["y", "x", "_c"]);
        assert.equal(vivLevel.dtype, "Uint8");
      }
      const jpegTile = await fromJpeg.levels[0]?.getTile({ x: 1, y: 1 });
      const losslessTile = await fromLossless.levels[0]?.getTile({ x: 1, y: 1 });
      assert.ok(jpegTile && losslessTile);
      assert.equal(jpegTile.data.length, 256 * 256 * 3);
      assert.ok(meanAbsoluteDifference(jpegTile.data, losslessTile.data) < 3);
    } finally {
      ycbcr.close();
      lossless.close();
    }
  });

  it("returns short edge tiles and averages the backing level into virtual ones", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      const custom: PixelSource = { ...source, levels: [source.levels[0] as PixelLevel] };
      const { levels, ladder } = createVivLevels(custom);
      assert.deepEqual(
        ladder.map(({ downsample, residual }) => [downsample, residual]),
        [
          [1, 1],
          [2, 2],
          [4, 4],
        ],
      );
      const averaged = await levels[1]?.getTile({ x: 1, y: 1 });
      assert.deepEqual([averaged?.width, averaged?.height], [256, 128]);
      const stored = await source.getTile({ level: 1, x: 1, y: 1 });
      assert.ok(!stored.absent);
      const interleaved = boxDownsampleToInterleaved(stored.planes, 256, 128, 1, 256, 128);
      assert.ok(averaged && meanAbsoluteDifference(averaged.data, interleaved) < 1);
    } finally {
      source.close();
    }
  });

  it("draws no black edge on a level whose backing level is stored a pixel short (CMU-1.svs sizes)", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      const custom: PixelSource = { ...source, levels: cmu1Levels };
      const tileSize = vivTileSize(custom);
      const { levels, ladder } = createVivLevels(custom, { read: filledWith(200) });
      for (const index of [2, 3, 4]) {
        const virtual = ladder[index];
        assert.ok(virtual);
        const tile = await levels[index]?.getTile({
          x: 0,
          y: Math.ceil(virtual.height / tileSize) - 1,
        });
        assert.ok(tile);
        assert.equal(tile.height, virtual.height % tileSize || tileSize);
        assert.equal(tile.data.indexOf(0), -1, `level ${index} has a black sample`);
      }
    } finally {
      source.close();
    }
  });

  it("reads the one-pixel tile column past a backing level that is stored a pixel short", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      const tileSize = vivTileSize(source);
      const custom: PixelSource = {
        ...source,
        levels: [level(1, tileSize * 16 + 1, 1_000), level(4, tileSize * 4, 250)],
      };
      const { levels, ladder } = createVivLevels(custom, { read: filledWith(200) });
      assert.equal(ladder[2]?.width, tileSize * 4 + 1);
      const tile = await levels[2]?.getTile({ x: 4, y: 0 });
      assert.ok(tile);
      assert.deepEqual([tile.width, tile.height], [1, 250]);
      assert.equal(tile.data.indexOf(0), -1);
    } finally {
      source.close();
    }
  });

  it("paints an absent tile as white glass (synthetic-sparse.tiff)", async () => {
    const source = await open("synthetic-sparse.tiff", "generic-tiff");
    try {
      const tile = await createVivLevels(source).levels[0]?.getTile({ x: 1, y: 0 });
      assert.ok(tile);
      assert.ok(tile.data.every((value) => value === 255));
    } finally {
      source.close();
    }
  });

  it("paints a chunk the ingest absence map marks absent as white glass, not black (generated sparse OME-Zarr 0.4)", async () => {
    const source = await openOmeZarrSource({
      formatId: "ome-zarr",
      url: served.url("/sparse.zarr"),
      index: readTileIndex({
        version: 1,
        formatId: "ome-zarr",
        zarrVersion: 2,
        levels: [{ downsample: 1, width: 512, height: 256, absentTiles: [[1, 1]] }],
      }),
    });
    try {
      const levels = createVivLevels(source).levels;
      const absent = await levels[0]?.getTile({ x: 1, y: 0 });
      assert.ok(absent);
      assert.ok(absent.data.every((value) => value === 255));
      const stored = await levels[0]?.getTile({ x: 0, y: 0 });
      assert.ok(stored);
      assert.equal(stored.data[3], sparseZarr.value(0, 0, 1, 0));
    } finally {
      source.close();
    }
  });

  it("rejects with Viv's abort sentinel once the signal is aborted", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      const levels = createVivLevels(source);
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        levels.levels[0]?.getTile({ x: 0, y: 0, signal: controller.signal }) ?? Promise.resolve(),
        (error: unknown) => error === vivSignalAborted,
      );
      assert.equal(levels.pending(), 0);
    } finally {
      source.close();
    }
  });

  it("rejects tiles outside the level", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      const top = createVivLevels(source).levels[0];
      await assert.rejects(top?.getTile({ x: 4, y: 0 }) ?? Promise.resolve(), RangeError);
      await assert.rejects(top?.getTile({ x: -1, y: 0 }) ?? Promise.resolve(), RangeError);
    } finally {
      source.close();
    }
  });

  it("refuses sources that are not 8-bit RGB", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    try {
      assert.throws(
        () => createVivLevels({ ...source, photometric: "grey" }),
        UnsupportedVivSourceError,
      );
      assert.throws(
        () => createVivLevels({ ...source, dtype: "uint16" }),
        UnsupportedVivSourceError,
      );
    } finally {
      source.close();
    }
  });
});

describe("slides and magnification", () => {
  it("describes a pixel slide from its source and closes the source with it", async () => {
    const source = await open("synthetic-zlib.ome.tiff", "ome-tiff");
    const slide = pixelSlide("s1", source);
    assert.deepEqual(
      [slide.id, slide.width, slide.height, slide.micronsPerPixel],
      ["s1", 1024, 768, 0.5],
    );
    slide.close();
    await assert.rejects(source.getTile({ level: 0, x: 0, y: 0 }), { name: "SourceClosedError" });
  });

  it("puts 10x at 1 µm per screen pixel", () => {
    assert.equal(zoomForMagnification(0.5, 20), 0);
    assert.equal(zoomForMagnification(0.5, 10), -1);
    assert.equal(zoomForMagnification(0.25, 40), 0);
    assert.ok(Math.abs(magnificationAtZoom(0.499, zoomForMagnification(0.499, 40)) - 40) < 1e-9);
    assert.throws(() => zoomForMagnification(0, 10), RangeError);
  });
});
