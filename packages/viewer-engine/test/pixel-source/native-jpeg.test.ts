import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { getDecoder } from "geotiff";
import {
  type NativeTileDecoder,
  type NativeTilePixels,
  openTiffSource,
  type PixelResult,
  type PixelSource,
  type Raster,
} from "../../src/index.ts";
import {
  assembleJpeg,
  chooseProbeTile,
  meanAbsoluteError,
} from "../../src/pixel-source/tiff/native-jpeg.ts";
import { syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";

const served = await serve({ "/synthetic": syntheticDir });

after(async () => {
  await served.close();
});

const tileSize = 256;

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

const faithfulDecoder: NativeTileDecoder = async (jpeg) => {
  const decoder = await getDecoder(7, {
    tileWidth: tileSize,
    tileHeight: tileSize,
    planarConfiguration: 1,
    bitsPerSample: 8,
    predictor: 1,
  });
  const samples = new Uint8Array(await decoder.decode(jpeg.buffer));
  const pixels = tileSize * tileSize;
  const rgba = new Uint8ClampedArray(pixels * 4);
  for (let at = 0; at < pixels; at++) {
    const y = samples[at * 3] ?? 0;
    const cb = (samples[at * 3 + 1] ?? 0) - 128;
    const cr = (samples[at * 3 + 2] ?? 0) - 128;
    rgba[at * 4] = clampByte(y + 1.402 * cr);
    rgba[at * 4 + 1] = clampByte(y - 0.344136 * cb - 0.714136 * cr);
    rgba[at * 4 + 2] = clampByte(y + 1.772 * cb);
    rgba[at * 4 + 3] = 255;
  }
  return { width: tileSize, height: tileSize, rgba };
};

const rawYcbcrDecoder: NativeTileDecoder = async (jpeg) => {
  const decoder = await getDecoder(7, {
    tileWidth: tileSize,
    tileHeight: tileSize,
    planarConfiguration: 1,
    bitsPerSample: 8,
    predictor: 1,
  });
  const samples = new Uint8Array(await decoder.decode(jpeg.buffer));
  const rgba = new Uint8ClampedArray(tileSize * tileSize * 4);
  for (let at = 0; at < tileSize * tileSize; at++) {
    rgba[at * 4] = samples[at * 3] ?? 0;
    rgba[at * 4 + 1] = samples[at * 3 + 1] ?? 0;
    rgba[at * 4 + 2] = samples[at * 3 + 2] ?? 0;
    rgba[at * 4 + 3] = 255;
  }
  return { width: tileSize, height: tileSize, rgba };
};

function open(file: string, nativeJpeg?: "off" | NativeTileDecoder): Promise<PixelSource> {
  return openTiffSource({
    formatId: "generic-tiff",
    url: served.url(`/synthetic/${file}`),
    ...(nativeJpeg === undefined ? {} : { nativeJpeg }),
  });
}

function present(result: PixelResult): Raster {
  assert.ok(!result.absent, "expected a present raster");
  return result;
}

async function report(source: PixelSource) {
  const reported = await source.decodeReport?.();
  assert.ok(reported, "the source reports its decoder");
  return reported;
}

const crossing = [100, 100, 600, 500] as const;

describe("native JPEG decode with per-file validation", () => {
  it("validates, uses the native decoder and matches the script decoder", async () => {
    const native = await open("synthetic-jpeg.tiff", faithfulDecoder);
    const script = await open("synthetic-jpeg.tiff", "off");
    const nativeRaster = present(await native.getRaster({ level: 0, window: crossing }));
    const scriptRaster = present(await script.getRaster({ level: 0, window: crossing }));
    const decoded = await report(native);
    assert.equal(decoded.jpeg, "native");
    assert.equal(decoded.reason, "agreed");
    assert.ok((decoded.meanAbsoluteError ?? 99) < 3);
    assert.ok(decoded.nativeReads > 0);
    assert.equal(decoded.scriptReads, 0);
    assert.equal(nativeRaster.width, 500);
    assert.equal(nativeRaster.height, 400);
    assert.ok(meanAbsoluteError(nativeRaster.planes, scriptRaster.planes) < 3);
  });

  it("falls back for the whole file when the native decode disagrees, and says why", async () => {
    const native = await open("synthetic-jpeg.tiff", rawYcbcrDecoder);
    const script = await open("synthetic-jpeg.tiff", "off");
    const served1 = present(await native.getRaster({ level: 0, window: crossing }));
    const reference = present(await script.getRaster({ level: 0, window: crossing }));
    const decoded = await report(native);
    assert.equal(decoded.jpeg, "script");
    assert.equal(decoded.reason, "disagreed");
    assert.ok((decoded.meanAbsoluteError ?? 0) > 3);
    assert.equal(decoded.nativeReads, 0);
    assert.equal(decoded.scriptReads, 1);
    assert.deepEqual(served1.planes, reference.planes);
  });

  it("reports that the native decoder is unavailable when it throws on the probe tile", async () => {
    const throwing: NativeTileDecoder = () => Promise.reject(new Error("no decoder"));
    const source = await open("synthetic-jpeg.tiff", throwing);
    present(await source.getTile({ level: 0, x: 1, y: 1 }));
    const decoded = await report(source);
    assert.equal(decoded.jpeg, "script");
    assert.equal(decoded.reason, "unavailable");
  });

  it("falls back for one read when the native decode of a tile fails later", async () => {
    let calls = 0;
    const flaky: NativeTileDecoder = (jpeg) => {
      calls++;
      return calls <= 1 ? faithfulDecoder(jpeg) : Promise.reject(new Error("decode failed"));
    };
    const source = await open("synthetic-jpeg.tiff", flaky);
    const script = await open("synthetic-jpeg.tiff", "off");
    const raster = present(await source.getRaster({ level: 0, window: crossing }));
    const reference = present(await script.getRaster({ level: 0, window: crossing }));
    const decoded = await report(source);
    assert.equal(decoded.jpeg, "native");
    assert.equal(decoded.nativeFallbacks, 1);
    assert.equal(decoded.scriptReads, 1);
    assert.deepEqual(raster.planes, reference.planes);
  });

  it("rejects a decoder that returns the wrong tile size", async () => {
    const small: NativeTileDecoder = (): Promise<NativeTilePixels> =>
      Promise.resolve({
        width: 8,
        height: 8,
        rgba: new Uint8Array(8 * 8 * 4),
      });
    const source = await open("synthetic-jpeg.tiff", small);
    present(await source.getTile({ level: 0, x: 0, y: 0 }));
    assert.equal((await report(source)).jpeg, "script");
  });

  it("keeps absent tiles as white glass and reports absent windows", async () => {
    const native = await open("synthetic-sparse.tiff", faithfulDecoder);
    const script = await open("synthetic-sparse.tiff", "off");
    for (const tile of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 2 },
    ]) {
      const a = await native.getTile({ level: 0, ...tile });
      const b = await script.getTile({ level: 0, ...tile });
      assert.equal(a.absent, b.absent);
      if (!a.absent && !b.absent) assert.ok(meanAbsoluteError(a.planes, b.planes) < 3);
    }
    const whole = present(await native.getRaster({ level: 0 }));
    const reference = present(await script.getRaster({ level: 0 }));
    assert.ok(meanAbsoluteError(whole.planes, reference.planes) < 3);
  });

  it("can be switched off, and says so", async () => {
    const source = await open("synthetic-jpeg.tiff", "off");
    present(await source.getTile({ level: 0, x: 0, y: 0 }));
    const decoded = await report(source);
    assert.equal(decoded.jpeg, "script");
    assert.equal(decoded.reason, "disabled");
  });

  it("has no browser decoder under Node, so it reads with the script decoder", async () => {
    const source = await open("synthetic-jpeg.tiff");
    present(await source.getTile({ level: 0, x: 0, y: 0 }));
    const decoded = await report(source);
    assert.equal(decoded.jpeg, "script");
    assert.equal(decoded.reason, "unavailable");
  });

  it("does not probe a file whose tiles are not JPEG", async () => {
    const source = await open("synthetic-zlib.ome.tiff", faithfulDecoder);
    present(await source.getTile({ level: 0, x: 0, y: 0 }));
    const decoded = await report(source);
    assert.equal(decoded.jpeg, "none");
    assert.equal(decoded.reason, "not-jpeg");
  });
});

describe("JPEG tile assembly and probe choice", () => {
  const tables = {
    tablesKey: "tables",
    prefix: Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x01),
  };

  it("joins the tables without their end marker to the tile without its start marker", () => {
    const tile = Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0x02, 0xff, 0xd9);
    assert.deepEqual(
      Array.from(assembleJpeg(tables, tile)),
      [0xff, 0xd8, 0xff, 0xdb, 0x01, 0xff, 0xc0, 0x02, 0xff, 0xd9],
    );
  });

  it("returns a complete stream unchanged when the file has no tables", () => {
    const tile = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
    assert.deepEqual(
      Array.from(assembleJpeg({ tablesKey: "none", prefix: null }, tile)),
      [0xff, 0xd8, 0xff, 0xd9],
    );
  });

  it("probes a whole present tile with the most bytes, never an edge or absent tile", () => {
    const counts = [0, 10, 30, 20, 0, 5, 50, 40, 8, 9, 7, 6];
    const tile = chooseProbeTile(1000, 600, 256, 256, 1024, counts, (index) => counts[index] === 0);
    assert.deepEqual(tile, { index: 6, window: [512, 256, 768, 512] });
  });

  it("finds no probe tile when every whole tile is absent", () => {
    assert.equal(
      chooseProbeTile(512, 512, 256, 256, 512, [0, 0, 0, 0], () => true),
      null,
    );
  });

  it("finds no probe tile when the level is smaller than one tile", () => {
    assert.equal(
      chooseProbeTile(200, 200, 256, 256, 256, [9], () => false),
      null,
    );
  });

  it("measures the mean absolute error across three planes", () => {
    const a = [Uint8Array.of(10, 20), Uint8Array.of(0, 0), Uint8Array.of(5, 5)];
    const b = [Uint8Array.of(12, 20), Uint8Array.of(0, 4), Uint8Array.of(5, 5)];
    assert.equal(meanAbsoluteError(a, b), 1);
    assert.equal(meanAbsoluteError(a, [b[0] ?? [], b[1] ?? []]), Number.POSITIVE_INFINITY);
  });
});
