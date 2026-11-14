import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type NativeTileDecoder,
  NdpiFormatError,
  openNdpiSource,
  type PixelResult,
  type PixelSource,
  SourceClosedError,
  tileColumns,
  tileRows,
} from "../../src/index.ts";
import { type NdpiPage, readRestartStarts } from "../../src/pixel-source/ndpi/directory.ts";
import { buildNdpiJpeg, parseNdpiFrame } from "../../src/pixel-source/ndpi/jpeg.ts";
import {
  expectedRgb,
  flatJpeg,
  levelColour,
  type NdpiLayout,
  type VirtualNdpi,
  virtualNdpi,
} from "./ndpi-fixture.ts";

const fourGigabytes = 2 ** 32;

function open(file: VirtualNdpi, nativeJpeg?: NativeTileDecoder | "off"): Promise<PixelSource> {
  return openNdpiSource({
    formatId: "hamamatsu-ndpi",
    url: "http://slides.test/virtual.ndpi",
    fetch: file.fetch,
    ...(nativeJpeg === undefined ? {} : { nativeJpeg }),
  });
}

function assertPattern(result: PixelResult, level: number, left: number, top: number): void {
  assert.equal(result.absent, false);
  if (result.absent) return;
  const colour = levelColour(level);
  let wrong = 0;
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const expected = expectedRgb(colour((left + x) >> 3, (top + y) >> 3));
      for (let channel = 0; channel < 3; channel++) {
        const value = result.planes[channel]?.[y * result.width + x] ?? -9;
        if (Math.abs(value - (expected[channel] ?? 0)) > 1) wrong++;
      }
    }
  }
  assert.equal(wrong, 0, `${wrong} samples differ at level ${level}, ${left},${top}`);
}

async function assertEveryTile(source: PixelSource): Promise<void> {
  for (const [index, level] of source.levels.entries()) {
    for (let y = 0; y < tileRows(level); y++) {
      for (let x = 0; x < tileColumns(level); x++) {
        const tile = await source.getTile({ level: index, x, y });
        assert.equal(tile.width, Math.min(level.tileWidth, level.width - x * level.tileWidth));
        assert.equal(tile.height, Math.min(level.tileHeight, level.height - y * level.tileHeight));
        assertPattern(tile, index, x * level.tileWidth, y * level.tileHeight);
      }
    }
  }
}

const layouts: readonly (readonly [NdpiLayout, string])[] = [
  ["high-words", "restart starts above 4 GB stored with their high words"],
  ["wrapping", "restart starts that wrap past 4 GB with no high words"],
  ["small", "a file below 4 GB"],
];

describe("NDPI source on a virtual file", () => {
  for (const [layout, title] of layouts) {
    it(`reads every tile of every level from ${title}`, async () => {
      const file = virtualNdpi(layout);
      assert.equal(file.size > fourGigabytes, layout !== "small");
      const source = await open(file);
      assert.deepEqual(
        source.levels.map((level) => `${level.downsample} ${level.width}x${level.height}`),
        ["1 1280x1088", "2 640x544", "4 320x272"],
      );
      assert.deepEqual(source.micronsPerPixel, { x: 0.25, y: 0.25 });
      assert.equal(source.photometric, "rgb");
      await assertEveryTile(source);
      if (layout !== "small") {
        assert.ok(file.requests.some((request) => request.offset > fourGigabytes));
      }
      source.close();
    });
  }

  it("reads a window that crosses decode units", async () => {
    const source = await open(virtualNdpi("high-words"));
    const raster = await source.getRaster({ level: 0, window: [500, 500, 1100, 1088] });
    assert.equal(raster.width, 600);
    assert.equal(raster.height, 588);
    assertPattern(raster, 0, 500, 500);
    source.close();
  });

  it("fetches one band of the level for a tile and keeps the decoded unit", async () => {
    const file = virtualNdpi("high-words");
    const source = await open(file);
    const from = file.requests.length;
    await source.getTile({ level: 0, x: 1, y: 1 });
    const read = file.requests.slice(from).reduce((sum, request) => sum + request.length, 0);
    const again = file.requests.length;
    await source.getTile({ level: 0, x: 1, y: 1 });
    assert.ok(read < 64000, `${read} bytes read for one tile`);
    assert.equal(file.requests.length, again);
    source.close();
  });

  it("takes the scale from a slide index when one is given", async () => {
    const file = virtualNdpi("small");
    const source = await openNdpiSource({
      formatId: "hamamatsu-ndpi",
      url: "http://slides.test/virtual.ndpi",
      fetch: file.fetch,
      index: { formatId: "hamamatsu-ndpi", micronsPerPixel: { x: 0.5, y: 0.5 } },
    });
    assert.deepEqual(source.micronsPerPixel, { x: 0.5, y: 0.5 });
    source.close();
  });

  it("uses a native decoder that agrees with the script decoder", async () => {
    const reference = await open(virtualNdpi("small"), "off");
    const native: NativeTileDecoder = async (jpeg) => {
      const frame = parseNdpiFrame(jpeg);
      assert.ok(frame !== null);
      const height = ((jpeg[frame.sizeOffset] ?? 0) << 8) | (jpeg[frame.sizeOffset + 1] ?? 0);
      const width = ((jpeg[frame.sizeOffset + 2] ?? 0) << 8) | (jpeg[frame.sizeOffset + 3] ?? 0);
      const level = reference.levels.findIndex((entry) => entry.width === width);
      const raster = await reference.getRaster({ level, window: [0, 0, width, height] });
      assert.equal(raster.absent, false);
      const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
      if (!raster.absent) {
        for (let at = 0; at < width * height; at++) {
          for (let channel = 0; channel < 3; channel++) {
            rgba[at * 4 + channel] = raster.planes[channel]?.[at] ?? 0;
          }
        }
      }
      return { width, height, rgba };
    };
    const source = await open(virtualNdpi("small"), native);
    const tile = await source.getTile({ level: 2, x: 0, y: 0 });
    assertPattern(tile, 2, 0, 0);
    const report = await source.decodeReport?.();
    assert.equal(report?.jpeg, "native");
    assert.equal(report?.reason, "agreed");
    assert.equal(report?.nativeReads, 1);
    source.close();
    reference.close();
  });

  it("falls back to the script decoder when the native colours disagree", async () => {
    const native: NativeTileDecoder = (jpeg) => {
      const frame = parseNdpiFrame(jpeg);
      assert.ok(frame !== null);
      const height = ((jpeg[frame.sizeOffset] ?? 0) << 8) | (jpeg[frame.sizeOffset + 1] ?? 0);
      const width = ((jpeg[frame.sizeOffset + 2] ?? 0) << 8) | (jpeg[frame.sizeOffset + 3] ?? 0);
      return Promise.resolve({ width, height, rgba: new Uint8ClampedArray(width * height * 4) });
    };
    const source = await open(virtualNdpi("small"), native);
    await assertEveryTile(source);
    const report = await source.decodeReport?.();
    assert.equal(report?.jpeg, "script");
    assert.equal(report?.reason, "disagreed");
    assert.equal(report?.nativeReads, 0);
    source.close();
  });

  it("keeps a tile loading for one caller when another aborts", async () => {
    const source = await open(virtualNdpi("small"));
    const controller = new AbortController();
    const aborted = source.getTile({ level: 0, x: 0, y: 0, signal: controller.signal });
    const kept = source.getTile({ level: 0, x: 0, y: 0 });
    controller.abort();
    await assert.rejects(aborted, { name: "AbortError" });
    assertPattern(await kept, 0, 0, 0);
    source.close();
  });

  it("refuses reads after it is closed", async () => {
    const source = await open(virtualNdpi("small"));
    source.close();
    await assert.rejects(source.getTile({ level: 0, x: 0, y: 0 }), SourceClosedError);
  });

  it("refuses a file that is not NDPI and a server without ranges", async () => {
    const zeros = (() =>
      Promise.resolve(
        new Response(new Uint8Array(12), { status: 206 }),
      )) as typeof globalThis.fetch;
    await assert.rejects(
      openNdpiSource({ formatId: "hamamatsu-ndpi", url: "http://slides.test/a", fetch: zeros }),
      (error: unknown) =>
        error instanceof NdpiFormatError &&
        /cannot be read as NDPI.*not a little-endian classic TIFF/.test(error.message),
    );
    const whole = (() =>
      Promise.resolve(new Response(new Uint8Array(12)))) as typeof globalThis.fetch;
    await assert.rejects(
      openNdpiSource({ formatId: "hamamatsu-ndpi", url: "http://slides.test/a", fetch: whole }),
      /answered 200/,
    );
  });
});

describe("NDPI restart index", () => {
  const page = (stripLength: number, count: number, high: boolean): NdpiPage => ({
    ifd: 0,
    offset: 0,
    width: 8,
    height: 8,
    compression: 7,
    stripOffset: 0,
    stripLength,
    sourceLens: 20,
    focalOffset: 0,
    resolutionUnit: 3,
    xResolutionOffset: null,
    yResolutionOffset: null,
    restartCount: count,
    restartOffset: 0,
    restartHighOffset: high ? 1000 : null,
  });
  const reader = (low: readonly number[], high: readonly number[] = []) => {
    const bytes = new Uint8Array(2000);
    const view = new DataView(bytes.buffer);
    for (const [index, value] of low.entries()) view.setUint32(index * 4, value, true);
    for (const [index, value] of high.entries()) view.setUint32(1000 + index * 4, value, true);
    return (offset: number, length: number) =>
      Promise.resolve(bytes.slice(offset, offset + length));
  };

  it("joins the low and high words of every start", async () => {
    const starts = await readRestartStarts(
      reader([600, 4294967000, 100, 5], [0, 0, 1, 3]),
      page(2 ** 34, 4, true),
    );
    assert.deepEqual([...starts], [600, 4294967000, fourGigabytes + 100, 3 * fourGigabytes + 5]);
  });

  it("lifts starts by 4 GB each time the low words wrap", async () => {
    const starts = await readRestartStarts(
      reader([600, 4294967000, 100, 4000000000, 7]),
      page(2 ** 34, 5, false),
    );
    assert.deepEqual(
      [...starts],
      [600, 4294967000, fourGigabytes + 100, fourGigabytes + 4000000000, 2 * fourGigabytes + 7],
    );
  });

  it("refuses starts that run backwards or past the strip", async () => {
    await assert.rejects(
      readRestartStarts(reader([600, 500], [0, 0]), page(2 ** 34, 2, true)),
      NdpiFormatError,
    );
    await assert.rejects(
      readRestartStarts(reader([600, 900]), page(800, 2, false)),
      NdpiFormatError,
    );
  });
});

describe("NDPI tile rebuild", () => {
  const whole = flatJpeg({ width: 96, height: 8, restartInterval: 1, colour: levelColour(0) });
  const frame = parseNdpiFrame(whole.bytes);

  it("asks for more bytes when the header is cut short", () => {
    assert.equal(parseNdpiFrame(whole.bytes.subarray(0, whole.headerLength - 3)), null);
    assert.throws(() => parseNdpiFrame(new Uint8Array(16)), NdpiFormatError);
  });

  it("reads the frame geometry and the restart interval", () => {
    assert.ok(frame !== null);
    assert.equal(frame.header.length, whole.headerLength);
    assert.equal(frame.mcuWidth, 8);
    assert.equal(frame.mcuHeight, 8);
    assert.equal(frame.restartInterval, 1);
    assert.equal(frame.storesRgb, false);
  });

  it("patches the size and renumbers the restart markers from zero", () => {
    assert.ok(frame !== null);
    const intervals = Array.from({ length: 11 }, (_, index) => Uint8Array.of(index + 1));
    const jpeg = buildNdpiJpeg(frame, 88, 8, intervals);
    assert.deepEqual([...jpeg.subarray(frame.sizeOffset, frame.sizeOffset + 4)], [0, 8, 0, 88]);
    const scan = [...jpeg.subarray(frame.header.length)];
    const markers = scan.filter((_, index) => scan[index - 1] === 0xff);
    assert.deepEqual(markers, [0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd0, 0xd1, 0xd9]);
    assert.equal(scan.length, 11 + 10 * 2 + 2);
    assert.deepEqual([...whole.bytes.subarray(0, 2)], [0xff, 0xd8]);
  });

  it("refuses a tile too large for one JPEG", () => {
    assert.ok(frame !== null);
    assert.throws(() => buildNdpiJpeg(frame, 70000, 8, []), NdpiFormatError);
  });
});
