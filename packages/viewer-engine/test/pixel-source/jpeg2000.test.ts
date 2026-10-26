import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { openTiffSource, type PixelArray, type PixelResult, type Raster } from "../../src/index.ts";
import Jpeg2000Decoder, {
  damagedTileGrey,
  hasCodestreamHeader,
  jpeg2000DamagedTileCount,
  MainThreadCodecError,
} from "../../src/pixel-source/tiff/jpeg2000/jpeg2000-decoder.ts";
import { openJpegLoadCount } from "../../src/pixel-source/tiff/jpeg2000/openjpeg-runtime.ts";
import { cachedFixture, cachedFixtureDir, syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";

const served = await serve({ "/synthetic": syntheticDir, "/cache": cachedFixtureDir() });

after(async () => {
  await served.close();
});

function present(result: PixelResult): Raster {
  assert.ok(!result.absent, "expected a present raster");
  return result;
}

function open(file: string, formatId: "generic-tiff" | "ome-tiff" = "generic-tiff") {
  return openTiffSource({ formatId, url: served.url(`/synthetic/${file}`) });
}

function meanAbsoluteDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index < a.length; index++)
    total += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  return total / a.length;
}

function everySample(planes: readonly PixelArray[], value: number): boolean {
  return planes.every((plane) => plane.every((sample) => sample === value));
}

const decoderParameters = {
  tileWidth: 256,
  tileHeight: 256,
  planarConfiguration: 1,
  bitsPerSample: [8, 8, 8],
  predictor: 1,
  samplesPerPixel: 3,
};

function rawTile(file: string, index: number): Uint8Array {
  const bytes = readFileSync(join(syntheticDir, file));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstIfd = view.getUint32(4, true);
  const entries = view.getUint16(firstIfd, true);
  const tag = (code: number): [number, number, number] => {
    for (let entry = 0; entry < entries; entry++) {
      const at = firstIfd + 2 + entry * 12;
      if (view.getUint16(at, true) === code) {
        return [
          view.getUint16(at + 2, true),
          view.getUint32(at + 4, true),
          view.getUint32(at + 8, true),
        ];
      }
    }
    throw new Error(`Tag ${code} is missing`);
  };
  const [, offsetCount, offsetsAt] = tag(324);
  const [, , countsAt] = tag(325);
  assert.ok(index < offsetCount);
  const offset = view.getUint32(offsetsAt + index * 4, true);
  const length = view.getUint32(countsAt + index * 4, true);
  return Uint8Array.from(bytes.subarray(offset, offset + length));
}

describe("JPEG 2000 is loaded only for slides that need it", () => {
  it("reads JPEG, deflate and big-endian slides without instantiating OpenJPEG", async () => {
    for (const file of [
      "synthetic-jpeg.tiff",
      "synthetic-zlib.ome.tiff",
      "synthetic-big-endian.tiff",
    ]) {
      const source = await open(file);
      present(await source.getTile({ level: 0, x: 1, y: 1 }));
      source.close();
    }
    assert.equal(openJpegLoadCount(), 0);
  });

  it("opens a JPEG 2000 slide without instantiating OpenJPEG until the first tile", async () => {
    const source = await open("synthetic-jp2k-33005.tiff");
    assert.equal(openJpegLoadCount(), 0);
    present(await source.getTile({ level: 0, x: 1, y: 1 }));
    assert.equal(openJpegLoadCount(), 1);
    present(await source.getTile({ level: 0, x: 2, y: 1 }));
    assert.equal(openJpegLoadCount(), 1);
    source.close();
  });
});

describe("JPEG 2000 tiles decode to the pixels of the lossless copy", () => {
  for (const [file, compression] of [
    ["synthetic-jp2k-33005.tiff", 33005],
    ["synthetic-jp2k-33003.tiff", 33003],
  ] as const) {
    it(`reads Aperio compression ${compression} as RGB (${file})`, async () => {
      const source = await open(file);
      const reference = await open("synthetic-zlib.ome.tiff", "ome-tiff");
      assert.equal(source.photometric, "rgb");
      assert.equal(source.dtype, "uint8");
      for (const level of [0, 1, 2]) {
        const window = [0, 0, 256, 192] as const;
        const ours = present(await source.getRaster({ level, window }));
        const expected = present(await reference.getRaster({ level, window }));
        for (let channel = 0; channel < 3; channel++) {
          const error = meanAbsoluteDifference(
            ours.planes[channel] ?? [],
            expected.planes[channel] ?? [],
          );
          assert.ok(error < 3, `level ${level} channel ${channel} differs by ${error}`);
        }
      }
    });
  }
});

describe("damaged JPEG 2000 tiles draw as grey, never as white glass", () => {
  it("replaces a tile with no codestream marker and a tile with a garbled body (synthetic-jp2k-damaged.tiff)", async () => {
    const damaged = await open("synthetic-jp2k-damaged.tiff");
    const intact = await open("synthetic-jp2k-33005.tiff");
    const before = jpeg2000DamagedTileCount();
    const noMarker = present(await damaged.getTile({ level: 0, x: 1, y: 0 }));
    assert.ok(everySample(noMarker.planes, damagedTileGrey));
    const garbled = present(await damaged.getTile({ level: 0, x: 2, y: 1 }));
    assert.ok(everySample(garbled.planes, damagedTileGrey));
    assert.equal(jpeg2000DamagedTileCount() - before, 2);
    for (const [x, y] of [
      [2, 0],
      [3, 1],
      [0, 2],
    ] as const) {
      const neighbour = present(await damaged.getTile({ level: 0, x, y }));
      const expected = present(await intact.getTile({ level: 0, x, y }));
      assert.deepEqual(neighbour.planes, expected.planes);
    }
    assert.equal(jpeg2000DamagedTileCount() - before, 2);
  });

  it("reads a window across a damaged tile and keeps the intact tiles beside it", async () => {
    const damaged = await open("synthetic-jp2k-damaged.tiff");
    const intact = await open("synthetic-jp2k-33005.tiff");
    const window = [0, 0, 1024, 256] as const;
    const ours = present(await damaged.getRaster({ level: 0, window }));
    const expected = present(await intact.getRaster({ level: 0, window }));
    for (const [channel, plane] of ours.planes.entries()) {
      const reference = expected.planes[channel] ?? [];
      for (let y = 0; y < 256; y++) {
        for (const column of [0, 1, 2, 3]) {
          const at = y * 1024 + column * 256 + 40;
          if (column === 1) assert.equal(plane[at], damagedTileGrey);
          else assert.equal(plane[at], reference[at]);
        }
      }
    }
  });

  it("treats a truncated codestream, an empty tile and a foreign payload as damaged", async () => {
    const decoder = new Jpeg2000Decoder(decoderParameters);
    const whole = rawTile("synthetic-jp2k-33005.tiff", 5);
    assert.ok(hasCodestreamHeader(whole));
    const expectedLength = 256 * 256 * 3;
    const intact = new Uint8Array(await decoder.decodeBlock(whole.buffer));
    assert.equal(intact.length, expectedLength);
    assert.ok(intact.some((sample) => sample !== damagedTileGrey));
    const payloads = [
      Uint8Array.from(whole.subarray(0, whole.length >> 1)),
      Uint8Array.from(whole.subarray(0, 40)),
      new Uint8Array(0),
      new Uint8Array(4096).fill(7),
    ];
    for (const payload of payloads) {
      const grey = new Uint8Array(await decoder.decodeBlock(payload.buffer));
      assert.equal(grey.length, expectedLength);
      assert.ok(grey.every((sample) => sample === damagedTileGrey));
    }
    const recovered = new Uint8Array(await decoder.decodeBlock(whole.buffer));
    assert.deepEqual(recovered, intact);
  });

  it("fills a 16-bit tile with 16-bit grey", async () => {
    const decoder = new Jpeg2000Decoder({
      ...decoderParameters,
      bitsPerSample: [16, 16, 16],
    });
    const grey = new Uint16Array(await decoder.decodeBlock(new Uint8Array(8).buffer));
    assert.equal(grey.length, 256 * 256 * 3);
    assert.ok(grey.every((sample) => sample === damagedTileGrey * 257));
  });
});

describe("JPEG 2000 never decodes on the main thread", () => {
  it("refuses a tile when the realm has a document", async () => {
    const decoder = new Jpeg2000Decoder(decoderParameters);
    const whole = rawTile("synthetic-jp2k-33005.tiff", 5);
    Reflect.set(globalThis, "document", {});
    try {
      await assert.rejects(decoder.decodeBlock(whole.buffer), MainThreadCodecError);
    } finally {
      Reflect.deleteProperty(globalThis, "document");
    }
    const tile = await decoder.decodeBlock(whole.buffer);
    assert.equal(tile.byteLength, 256 * 256 * 3);
  });
});

async function stainedTile(
  file: string,
  tile: { level: number; x: number; y: number },
): Promise<Raster> {
  const source = await openTiffSource({
    formatId: "aperio-svs",
    url: served.url(`/cache/${file}`),
  });
  try {
    return present(await source.getTile(tile));
  } finally {
    source.close();
  }
}

function planeMeans(raster: Raster): number[] {
  return raster.planes.map((plane) => {
    let total = 0;
    for (const sample of plane) total += sample;
    return total / plane.length;
  });
}

function assertMeans(raster: Raster, openSlide: readonly number[], limit: number): void {
  for (const [channel, mean] of planeMeans(raster).entries()) {
    const expected = openSlide[channel] ?? 0;
    assert.ok(
      Math.abs(mean - expected) < limit,
      `channel ${channel} mean ${mean} against OpenSlide ${expected}`,
    );
  }
}

describe("Aperio JPEG 2000 colour is applied exactly once", () => {
  it("matches OpenSlide on a stained tile of JP2K-33003-1.svs (YCbCr, compression 33003)", async (t) => {
    if (cachedFixture("JP2K-33003-1.svs") === null)
      return t.skip("JP2K-33003-1.svs is not cached, run: pnpm fixtures formats");
    const tile = await stainedTile("JP2K-33003-1.svs", { level: 0, x: 40, y: 12 });
    assertMeans(tile, [203.8, 110.3, 148.9], 1);
    const openSlideFirstRow = [235, 231, 196, 197, 194, 192, 180, 193];
    for (const [at, value] of openSlideFirstRow.entries()) {
      assert.ok(Math.abs((tile.planes[0]?.[at] ?? 0) - value) <= 2);
    }
  });

  it("matches OpenSlide on a stained tile of CMU-1-JP2K-33005.svs (RGB, compression 33005)", async (t) => {
    if (cachedFixture("CMU-1-JP2K-33005.svs") === null)
      return t.skip("CMU-1-JP2K-33005.svs is not cached, run: pnpm fixtures formats");
    const tile = await stainedTile("CMU-1-JP2K-33005.svs", { level: 0, x: 119, y: 44 });
    assertMeans(tile, [178.9, 140.1, 173.4], 0.5);
  });
});
