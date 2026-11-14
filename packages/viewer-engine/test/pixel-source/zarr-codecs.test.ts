import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { syntheticDir } from "@parfocal/test-fixtures";
import {
  createDefaultPixelSourceRegistry,
  nativeAgreementThreshold,
  openOmeZarrSource,
  type PixelSource,
  type Raster,
  type SlideIndex,
} from "../../src/index.ts";
import { meanAbsoluteError } from "../../src/pixel-source/tiff/native-jpeg.ts";
import { tagJpegChunks } from "../../src/pixel-source/zarr/jpeg-chunk.ts";
import { type Expected, pixelSourceConformance } from "./conformance.ts";
import { serve } from "./serve.ts";
import { writeZarrFixture, type ZarrFixtureOptions } from "./zarr-fixture.ts";

const jpegStores = {
  "OME-Zarr 0.4 with JPEG chunks": "synthetic-jpeg.ome.zarr",
  "OME-Zarr 0.5 sharded with JPEG chunks": "synthetic-jpeg-sharded.ome.zarr",
} as const;

const lossless: Record<string, ZarrFixtureOptions> = {
  "OME-Zarr 0.5 sharded 16-bit zstd": {
    version: 3,
    dtype: "uint16",
    channels: 1,
    width: 260,
    height: 130,
    chunk: 64,
    levels: 3,
    shard: 2,
    codec: "zstd",
  },
  "OME-Zarr 0.5 sharded RGB gzip": {
    version: 3,
    dtype: "uint8",
    channels: 3,
    width: 300,
    height: 200,
    chunk: 64,
    levels: 2,
    shard: 2,
    codec: "gzip",
  },
  "OME-Zarr 0.5 RGB zstd": {
    version: 3,
    dtype: "uint8",
    channels: 3,
    width: 300,
    height: 200,
    chunk: 128,
    levels: 2,
    codec: "zstd",
  },
  "OME-Zarr 0.4 RGB zstd": {
    version: 2,
    dtype: "uint8",
    channels: 3,
    width: 300,
    height: 200,
    chunk: 128,
    levels: 2,
    codec: "zstd",
  },
};

const sparseOptions: ZarrFixtureOptions = {
  version: 3,
  dtype: "uint8",
  channels: 3,
  width: 256,
  height: 256,
  chunk: 64,
  levels: 1,
  shard: 2,
  missing: [
    [0, 0, 1],
    [0, 2, 2],
    [0, 2, 3],
    [0, 3, 2],
    [0, 3, 3],
  ],
};

const written = await Promise.all(
  Object.entries(lossless).map(
    async ([name, options]) => [name, options, await writeZarrFixture(options)] as const,
  ),
);
const sparse = await writeZarrFixture(sparseOptions);
await rm(join(sparse.root, "0", "c", "0", "1", "1"));

const served = await serve({
  "/synthetic": syntheticDir,
  "/sparse": sparse.root,
  ...Object.fromEntries(written.map(([, , fixture], index) => [`/lossless${index}`, fixture.root])),
});

after(async () => {
  await served.close();
  await sparse.remove();
  await Promise.all(written.map(([, , fixture]) => fixture.remove()));
});

const open = (path: string, extra: { index?: SlideIndex; nativeJpeg?: "off" } = {}) =>
  openOmeZarrSource({ formatId: "ome-zarr", url: served.url(path), ...extra });

async function rasters(source: PixelSource): Promise<Raster[]> {
  const read: Raster[] = [];
  for (const level of source.levels.keys()) {
    const raster = await source.getRaster({ level });
    assert.equal(raster.absent, false);
    if (!raster.absent) read.push(raster);
  }
  return read;
}

const synthetic: Expected = { levels: 3, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.5 };

for (const [name, store] of Object.entries(jpegStores)) {
  pixelSourceConformance(`zarrita, ${name}`, () => open(`/synthetic/${store}`), synthetic);

  describe(`${name} against the lossless OME-TIFF of the same picture`, () => {
    it("decodes every level to the same RGB within the JPEG agreement threshold", async () => {
      const reference = await createDefaultPixelSourceRegistry().open({
        formatId: "ome-tiff",
        url: served.url("/synthetic/synthetic-zlib.ome.tiff"),
      });
      const source = await open(`/synthetic/${store}`);
      const expected = await rasters(reference);
      const actual = await rasters(source);
      assert.deepEqual(
        source.levels.map(({ width, height, downsample }) => [width, height, downsample]),
        reference.levels.map(({ width, height, downsample }) => [width, height, downsample]),
      );
      for (const [level, raster] of actual.entries()) {
        const error = meanAbsoluteError(raster.planes, expected[level]?.planes ?? []);
        assert.ok(error <= nativeAgreementThreshold, `level ${level} differs by ${error}`);
        assert.ok(error > 0, `level ${level} is lossy`);
      }
      reference.close();
      source.close();
    });

    it("keeps red, green and blue in their own planes", async () => {
      const source = await open(`/synthetic/${store}`);
      const tile = await source.getTile({ level: 0, x: 3, y: 2 });
      assert.equal(tile.absent, false);
      if (tile.absent) return;
      const at = 150 * tile.width + 150;
      const pixel = tile.planes.map((plane) => plane[at] ?? 0);
      for (const [channel, value] of [200, 40, 90].entries()) {
        assert.ok(Math.abs((pixel[channel] ?? 0) - value) <= 4, `${pixel.join(",")}`);
      }
      source.close();
    });

    it("reports which JPEG decoder read the chunks", async () => {
      const source = await open(`/synthetic/${store}`);
      const report = await source.decodeReport?.();
      assert.deepEqual(
        [report?.jpeg, report?.reason, report?.scriptReads],
        ["script", "unavailable", 1],
      );
      source.close();
      const disabled = await open(`/synthetic/${store}`, { nativeJpeg: "off" });
      await disabled.getTile({ level: 1, x: 0, y: 0 });
      const off = await disabled.decodeReport?.();
      assert.deepEqual([off?.jpeg, off?.reason, off?.scriptReads], ["script", "disabled", 1]);
      disabled.close();
    });
  });
}

describe("OME-Zarr 0.5 sharded with JPEG chunks over the wire", () => {
  it("reads a tile with two range requests on its shard and no whole file", async () => {
    const source = await open("/synthetic/synthetic-jpeg-sharded.ome.zarr");
    const from = served.log.length;
    await source.getTile({ level: 0, x: 1, y: 1 });
    source.close();
    const requests = served.log.slice(from);
    assert.deepEqual(
      requests.map((entry) => entry.path.split(".ome.zarr")[1]),
      ["/0/c/0/0/0", "/0/c/0/0/0"],
    );
    assert.ok(requests.every((entry) => entry.range !== null));
  });
});

for (const [index, [name, options, fixture]] of written.entries()) {
  pixelSourceConformance(`zarrita, ${name}`, () => open(`/lossless${index}`), {
    levels: options.levels,
    photometric: options.channels === 3 ? "rgb" : "grey",
    dtype: options.dtype,
    micronsPerPixel: 0.5,
  });

  describe(`${name} is lossless`, () => {
    it("reads every sample of every level as it was written", async () => {
      const source = await open(`/lossless${index}`);
      assert.equal((await source.decodeReport?.())?.jpeg, "none");
      for (const [level, raster] of (await rasters(source)).entries()) {
        for (const [channel, plane] of raster.planes.entries()) {
          for (let y = 0; y < raster.height; y++) {
            for (let x = 0; x < raster.width; x++) {
              const value = plane[y * raster.width + x];
              if (value !== fixture.value(level, channel, x, y)) {
                assert.fail(`level ${level} channel ${channel} at ${x},${y} reads ${value}`);
              }
            }
          }
        }
      }
      source.close();
    });
  });
}

describe("an inner chunk left out of a shard that exists", () => {
  const index: SlideIndex = {
    formatId: "ome-zarr",
    zarrVersion: 3,
    levels: [
      {
        path: "0",
        downsample: 1,
        width: 256,
        height: 256,
        tileWidth: 64,
        tileHeight: 64,
        absentTiles: [
          [1, 1],
          [10, 2],
          [14, 2],
        ],
      },
    ],
  };

  it("reads as fill without the slide index, because zarrita cannot tell it from black", async () => {
    const source = await open("/sparse");
    const tile = await source.getTile({ level: 0, x: 1, y: 0 });
    assert.equal(tile.absent, false);
    if (!tile.absent) assert.ok(tile.planes.every((plane) => plane.every((value) => value === 0)));
    source.close();
  });

  it("is absent with the absence map of the slide index, with no request", async () => {
    const source = await open("/sparse", { index });
    const from = served.log.length;
    assert.deepEqual(await source.getTile({ level: 0, x: 1, y: 0 }), {
      absent: true,
      width: 64,
      height: 64,
    });
    assert.equal(served.log.length, from);
    const present = await source.getTile({ level: 0, x: 0, y: 0 });
    assert.equal(present.absent, false);
    source.close();
  });

  it("is absent when the whole shard file is missing, with or without the index", async () => {
    for (const extra of [{}, { index }]) {
      const source = await open("/sparse", extra);
      assert.equal((await source.getTile({ level: 0, x: 3, y: 3 })).absent, true);
      source.close();
    }
  });

  it("paints background over the absent chunks of a raster and keeps the rest", async () => {
    const source = await open("/sparse", { index });
    const raster = await source.getRaster({ level: 0 });
    assert.equal(raster.absent, false);
    if (raster.absent) return;
    const sample = (channel: number, x: number, y: number) =>
      raster.planes[channel]?.[y * raster.width + x];
    assert.equal(sample(0, 100, 10), 255);
    assert.equal(sample(2, 200, 200), 255);
    assert.equal(sample(1, 10, 10), sparse.value(0, 1, 10, 10));
    assert.equal(sample(1, 100, 100), sparse.value(0, 1, 100, 100));
    source.close();
  });
});

describe("the JPEG chunk codec names", () => {
  const tag = (metadata: unknown): unknown => {
    const bytes = tagJpegChunks(new TextEncoder().encode(JSON.stringify(metadata)), "token");
    return bytes === null ? null : (JSON.parse(new TextDecoder().decode(bytes)) as unknown);
  };

  it("finds the version 2 compressor and both version 3 names, also inside a shard", () => {
    assert.deepEqual(tag({ compressor: { id: "imagecodecs_jpeg", level: 90 } }), {
      compressor: { id: "imagecodecs_jpeg", level: 90, decoder: "token" },
    });
    for (const name of ["imagecodecs_jpeg", "numcodecs.imagecodecs_jpeg"]) {
      assert.deepEqual(tag({ codecs: [{ name: "bytes" }, { name }] }), {
        codecs: [{ name: "bytes" }, { name, configuration: { decoder: "token" } }],
      });
      assert.deepEqual(
        tag({ codecs: [{ name: "sharding_indexed", configuration: { codecs: [{ name }] } }] }),
        {
          codecs: [
            {
              name: "sharding_indexed",
              configuration: { codecs: [{ name, configuration: { decoder: "token" } }] },
            },
          ],
        },
      );
    }
  });

  it("leaves other metadata alone", () => {
    assert.equal(tag({ compressor: { id: "zstd", level: 3 } }), null);
    assert.equal(tag({ attributes: { note: "imagecodecs_jpeg" } }), null);
  });
});
