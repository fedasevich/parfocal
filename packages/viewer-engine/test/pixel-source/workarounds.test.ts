import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fromUrl } from "geotiff";
import * as zarr from "zarrita";
import {
  openOmeZarrSource,
  openTiffSource,
  type PixelResult,
  type Raster,
  recoverLadder,
} from "../../src/index.ts";
import { cachedFixture, cachedFixtureDir, syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";
import { writeZarrFixture } from "./zarr-fixture.ts";

const zarrOptions = {
  dtype: "uint8",
  channels: 3,
  width: 300,
  height: 200,
  chunk: 128,
  levels: 2,
} as const;
const sparseZarr = await writeZarrFixture({ ...zarrOptions, version: 2, missing: [[0, 0, 1]] });
const zarrV3 = await writeZarrFixture({ ...zarrOptions, version: 3 });

const served = await serve({
  "/synthetic": syntheticDir,
  "/cache": cachedFixtureDir(),
  "/sparse.zarr": sparseZarr.root,
  "/v3.zarr": zarrV3.root,
});
const spa = await serve({ "/v3.zarr": zarrV3.root }, { spaFallback: true });

after(async () => {
  await Promise.all([served.close(), spa.close(), sparseZarr.remove(), zarrV3.remove()]);
});

function present(result: PixelResult): Raster {
  assert.ok(!result.absent, "expected a present raster");
  return result;
}

function meanAbsoluteDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < a.length; index++)
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return total / a.length;
}

async function rawImage(path: string, index = 0) {
  return (await fromUrl(served.url(path))).getImage(index);
}

const lossless = () =>
  openTiffSource({ formatId: "ome-tiff", url: served.url("/synthetic/synthetic-zlib.ome.tiff") });

describe("geotiff workaround: YCbCr tiles get the photometric transform", () => {
  it("raw readRasters returns Y, Cb and Cr, and the source returns RGB (synthetic-jpeg.tiff)", async () => {
    const window = [512, 256, 768, 512];
    const raw = await rawImage("/synthetic/synthetic-jpeg.tiff");
    assert.equal(raw.fileDirectory.getValue("PhotometricInterpretation"), 6);
    const planes = (await raw.readRasters({
      window,
      interleave: false,
      samples: [0, 1, 2],
    })) as unknown as Uint8Array[];
    const reference = present(await (await lossless()).getTile({ level: 0, x: 2, y: 1 }));
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url: served.url("/synthetic/synthetic-jpeg.tiff"),
    });
    const tile = present(await source.getTile({ level: 0, x: 2, y: 1 }));
    for (let channel = 0; channel < 3; channel++) {
      const expected = reference.planes[channel] ?? new Uint8Array();
      assert.ok(
        meanAbsoluteDifference(tile.planes[channel] ?? [], expected) < 3,
        "the source matches the lossless copy",
      );
    }
    assert.ok(
      meanAbsoluteDifference(planes[1] ?? [], reference.planes[1] ?? []) > 20,
      "raw samples are not RGB",
    );
  });

  it("reads glass as white on the CAMELYON16 slide (tumor_009.tif, cached)", async (t) => {
    if (cachedFixture("tumor_009.tif") === null)
      return t.skip("tumor_009.tif is not cached, run: pnpm fixtures camelyon");
    const source = await openTiffSource({
      formatId: "philips-tiff",
      url: served.url("/cache/tumor_009.tif"),
    });
    const tile = present(await source.getTile({ level: 5, x: 1, y: 1 }));
    const raw = await rawImage("/cache/tumor_009.tif", 5);
    const planes = (await raw.readRasters({
      window: [512, 512, 1024, 1024],
      interleave: false,
      samples: [0, 1, 2],
    })) as unknown as Uint8Array[];
    assert.equal(planes[1]?.[0], 128, "raw Cb of glass sits at the neutral point");
    assert.deepEqual(
      [tile.planes[0]?.[0], tile.planes[1]?.[0], tile.planes[2]?.[0]],
      [255, 255, 255],
    );
  });
});

describe("geotiff workaround: directories are lazy, so tags are loaded at open", () => {
  it("the OME-XML description is deferred and still yields the pixel size (synthetic-zlib.ome.tiff)", async () => {
    const raw = await rawImage("/synthetic/synthetic-zlib.ome.tiff");
    assert.equal(Reflect.get(raw.fileDirectory, "ImageDescription"), undefined);
    const tag = "ImageDescription" as Parameters<typeof raw.fileDirectory.getValue>[0];
    assert.throws(() => raw.fileDirectory.getValue(tag), /deferred/);
    const description: unknown = await raw.fileDirectory.loadValue("ImageDescription");
    assert.match(String(description), /PhysicalSizeX="0.5"/);
    const source = await lossless();
    assert.deepEqual(source.micronsPerPixel, { x: 0.5, y: 0.5 });
  });
});

describe("geotiff workaround: big-endian files read their deferred offset arrays eagerly", () => {
  it("raw geotiff fails on the tile offsets, and the source reads exact pixels (synthetic-big-endian.tiff)", async () => {
    const raw = await rawImage("/synthetic/synthetic-big-endian.tiff");
    assert.ok(raw.fileDirectory.deferredArrays.has(324), "TileOffsets is deferred");
    await assert.rejects(raw.readRasters({ window: [0, 0, 32, 32] }), /MAX_SAFE_INTEGER/);
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url: served.url("/synthetic/synthetic-big-endian.tiff"),
    });
    const reference = await lossless();
    for (const level of [0, 1, 2]) {
      const window = [0, 0, 64, 64] as const;
      const ours = present(await source.getRaster({ level, window }));
      const expected = present(await reference.getRaster({ level, window }));
      assert.deepEqual(ours.planes, expected.planes, `level ${level}`);
    }
  });
});

describe("geotiff workaround: absent tiles are found from byte counts read at open", () => {
  it("raw readRGB paints an absent YCbCr tile green, and the source reports it absent without a request (synthetic-sparse.tiff)", async () => {
    const raw = await rawImage("/synthetic/synthetic-sparse.tiff");
    const green = (await raw.readRGB({
      window: [256, 0, 260, 4],
      interleave: false,
    })) as unknown as Uint8Array[];
    assert.deepEqual([green[0]?.[0], green[1]?.[0], green[2]?.[0]], [0, 135, 0]);
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url: served.url("/synthetic/synthetic-sparse.tiff"),
    });
    const before = served.requests.length;
    const absent = await source.getTile({ level: 0, x: 1, y: 0 });
    assert.deepEqual(absent, { absent: true, width: 256, height: 256 });
    assert.equal(served.requests.length, before, "an absent tile costs no request");
    const mixed = present(await source.getRaster({ level: 0, window: [200, 0, 300, 10] }));
    const row = Array.from({ length: 100 }, (_, x) => [
      mixed.planes[0]?.[x],
      mixed.planes[1]?.[x],
      mixed.planes[2]?.[x],
    ]);
    assert.ok(
      row.slice(56).every((pixel) => pixel.every((value) => value === 255)),
      "absent part is background",
    );
    assert.ok(
      row.slice(0, 56).some((pixel) => pixel[0] !== 255),
      "present part keeps its pixels",
    );
    assert.equal(present(await source.getTile({ level: 1, x: 0, y: 0 })).absent, false);
  });

  it("finds the unscanned tiles of a Philips slide (Philips-4.tiff, cached)", async (t) => {
    if (cachedFixture("Philips-4.tiff") === null)
      return t.skip("Philips-4.tiff is not cached, run: pnpm fixtures formats");
    const source = await openTiffSource({
      formatId: "philips-tiff",
      url: served.url("/cache/Philips-4.tiff"),
    });
    assert.equal((await source.getTile({ level: 0, x: 0, y: 0 })).absent, true);
  });
});

describe("geotiff workaround: pyramids in SubIFDs are read", () => {
  it("raw geotiff sees one image, and the source sees three levels (synthetic-zlib.ome.tiff)", async () => {
    const tiff = await fromUrl(served.url("/synthetic/synthetic-zlib.ome.tiff"));
    assert.equal(await tiff.getImageCount(), 1);
    const source = await lossless();
    assert.deepEqual(
      source.levels.map((level) => [level.downsample, level.width, level.height]),
      [
        [1, 1024, 768],
        [2, 512, 384],
        [4, 256, 192],
      ],
    );
  });
});

describe("reader workaround: level scale comes from the padding rule, not the stored size", () => {
  it("recovers the true factors of tumor_009's padded IFD sizes", () => {
    const stored = [
      [97792, 217088],
      [49152, 108544],
      [24576, 54272],
      [12288, 27136],
      [6144, 13824],
      [3072, 7168],
      [1536, 3584],
      [1024, 2048],
      [512, 1024],
      [512, 512],
    ].map(([width = 0, height = 0]) => ({ width, height, tileWidth: 512, tileHeight: 512 }));
    const ladder = recoverLadder(stored);
    assert.deepEqual(
      ladder.map((step) => `${step.downsample} ${step.width}x${step.height}`),
      [
        "1 97792x217088",
        "2 48896x108544",
        "4 24448x54272",
        "8 12224x27136",
        "16 6112x13568",
        "32 3056x6784",
        "64 1528x3392",
        "128 764x1696",
        "256 382x848",
        "512 191x424",
      ],
    );
    assert.equal(97792 / 512, 191, "the stored-size ratio at the coarsest level would say 191");
  });

  it("keeps floored Aperio sizes and drops a level that halves nothing", () => {
    const ladder = recoverLadder([
      { width: 46000, height: 32914, tileWidth: 256, tileHeight: 256 },
      { width: 11500, height: 8228, tileWidth: 256, tileHeight: 256 },
      { width: 11000, height: 8000, tileWidth: 256, tileHeight: 256 },
      { width: 2875, height: 2057, tileWidth: 256, tileHeight: 256 },
    ]);
    assert.deepEqual(
      ladder.map((step) => [step.stored, step.downsample]),
      [
        [0, 1],
        [1, 4],
        [3, 16],
      ],
    );
  });
});

describe("geotiff gap closed: JPEG 2000 tiles are decoded by the registered OpenJPEG decoder", () => {
  it("opens an Aperio JPEG 2000 slide and reads a tile of RGB samples (JP2K-33003-1.svs, cached)", async (t) => {
    if (cachedFixture("JP2K-33003-1.svs") === null)
      return t.skip("JP2K-33003-1.svs is not cached, run: pnpm fixtures formats");
    const source = await openTiffSource({
      formatId: "aperio-svs",
      url: served.url("/cache/JP2K-33003-1.svs"),
    });
    const tile = present(await source.getTile({ level: 0, x: 40, y: 12 }));
    assert.equal(tile.planes.length, 3);
    assert.equal(tile.planes[0]?.length, 256 * 256);
    source.close();
  });
});

describe("zarrita workaround: store URLs are made absolute", () => {
  it("FetchStore refuses a relative URL, and the source resolves it against the base (generated OME-Zarr 0.5)", async () => {
    await assert.rejects(zarr.open(new zarr.FetchStore("/v3.zarr"), { kind: "group" }), TypeError);
    const source = await openOmeZarrSource({
      formatId: "ome-zarr",
      url: "/v3.zarr",
      baseUrl: served.origin,
    });
    assert.equal(source.levels.length, 2);
  });
});

describe("zarrita fix kept as a regression test: an HTML fallback page does not break version detection", () => {
  it("zarrita 0.7.5 opens a v3 store behind an SPA fallback without help (generated OME-Zarr 0.5)", async () => {
    const group = await zarr.open(new zarr.FetchStore(spa.url("/v3.zarr")), { kind: "group" });
    assert.ok("ome" in group.attrs);
    const source = await openOmeZarrSource({ formatId: "ome-zarr", url: spa.url("/v3.zarr") });
    assert.equal(source.photometric, "rgb");
    const tile = present(await source.getTile({ level: 0, x: 0, y: 0 }));
    assert.equal(tile.planes[0]?.[1], zarrV3.value(0, 0, 1, 0));
  });
});

describe("zarrita workaround: a missing chunk is absent, not fill", () => {
  it("raw zarrita returns zeros, and the source reports the tile absent (generated sparse OME-Zarr 0.4)", async () => {
    const root = await zarr.open(new zarr.FetchStore(served.url("/sparse.zarr")), {
      kind: "group",
    });
    const array = await zarr.open(root.resolve("0"), { kind: "array" });
    const chunk = await array.getChunk([0, 0, 1]);
    assert.ok(
      Array.from(chunk.data as Uint8Array).every((value) => value === 0),
      "zarrita fills a missing chunk",
    );
    const source = await openOmeZarrSource({
      formatId: "ome-zarr",
      url: served.url("/sparse.zarr"),
    });
    assert.deepEqual(await source.getTile({ level: 0, x: 1, y: 0 }), {
      absent: true,
      width: 128,
      height: 128,
    });
    const mixed = present(await source.getRaster({ level: 0, window: [120, 0, 136, 1] }));
    assert.equal(mixed.planes[0]?.[0], sparseZarr.value(0, 0, 120, 0));
    assert.deepEqual(Array.from(mixed.planes[0]?.slice(8) ?? []), new Array(8).fill(255));
  });
});
