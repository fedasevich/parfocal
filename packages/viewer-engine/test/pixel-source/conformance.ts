import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  type PixelArray,
  type PixelDtype,
  type PixelLevel,
  type PixelResult,
  type PixelSource,
  type Raster,
  SourceClosedError,
  tileColumns,
  tileRows,
} from "../../src/index.ts";

export interface Expected {
  readonly levels: number;
  readonly photometric: PixelSource["photometric"];
  readonly dtype: PixelDtype;
  readonly micronsPerPixel: number | null;
  readonly levelSizes?: readonly string[];
}

const arrayTypes: Record<PixelDtype, abstract new (...args: never[]) => PixelArray> = {
  uint8: Uint8Array,
  uint16: Uint16Array,
  uint32: Uint32Array,
  int8: Int8Array,
  int16: Int16Array,
  int32: Int32Array,
  float32: Float32Array,
  float64: Float64Array,
};

function checkResult(
  source: PixelSource,
  result: PixelResult,
  width: number,
  height: number,
): void {
  assert.equal(result.width, width);
  assert.equal(result.height, height);
  if (result.absent) return;
  assert.equal(result.planes.length, source.channels.length);
  for (const plane of result.planes) {
    assert.ok(plane instanceof arrayTypes[source.dtype], `planes must be ${source.dtype}`);
    assert.equal(plane.length, width * height);
  }
}

function edge(level: PixelLevel, x: number, y: number): [number, number] {
  return [
    Math.min(level.tileWidth, level.width - x * level.tileWidth),
    Math.min(level.tileHeight, level.height - y * level.tileHeight),
  ];
}

function sample(raster: Raster, channel: number, x: number, y: number): number | undefined {
  return raster.planes[channel]?.[y * raster.width + x];
}

export function pixelSourceConformance(
  name: string,
  open: () => Promise<PixelSource>,
  expected: Expected,
): void {
  describe(`PixelSource conformance: ${name}`, () => {
    let source: PixelSource;

    before(async () => {
      source = await open();
    });

    after(() => {
      source.close();
    });

    it("matches the expected description", () => {
      assert.equal(source.levels.length, expected.levels);
      assert.equal(source.photometric, expected.photometric);
      assert.equal(source.dtype, expected.dtype);
      if (expected.micronsPerPixel === null) {
        assert.equal(source.micronsPerPixel, null);
      } else {
        assert.ok(source.micronsPerPixel !== null);
        assert.ok(Math.abs(source.micronsPerPixel.x - expected.micronsPerPixel) < 1e-6);
        assert.ok(Math.abs(source.micronsPerPixel.y - expected.micronsPerPixel) < 1e-6);
      }
      if (expected.levelSizes !== undefined) {
        assert.deepEqual(
          source.levels.map((level) => `${level.downsample} ${level.width}x${level.height}`),
          expected.levelSizes,
        );
      }
    });

    it("lists levels finest first with content sizes that follow the downsample", () => {
      const [base] = source.levels;
      assert.ok(base !== undefined);
      assert.equal(base.downsample, 1);
      let previous = 0;
      for (const level of source.levels) {
        assert.ok(level.downsample > previous, "downsample must increase");
        previous = level.downsample;
        for (const value of [level.width, level.height, level.tileWidth, level.tileHeight]) {
          assert.ok(Number.isInteger(value) && value > 0);
        }
        assert.ok(level.width >= Math.floor(base.width / level.downsample) - 1);
        assert.ok(level.width <= Math.ceil(base.width / level.downsample));
        assert.ok(level.height >= Math.floor(base.height / level.downsample) - 1);
        assert.ok(level.height <= Math.ceil(base.height / level.downsample));
      }
      assert.deepEqual(source.tileSize, { width: base.tileWidth, height: base.tileHeight });
    });

    it("describes channels that fit the photometric mode", () => {
      if (source.photometric === "rgb") {
        assert.equal(source.channels.length, 3);
        assert.equal(source.dtype, "uint8");
      } else if (source.photometric === "grey") {
        assert.equal(source.channels.length, 1);
      } else {
        assert.ok(source.channels.length >= 2);
      }
      for (const channel of source.channels) assert.ok(channel.name.length > 0);
    });

    it("returns the first and last tile of every level at their true size", async () => {
      for (const [index, level] of source.levels.entries()) {
        const lastX = tileColumns(level) - 1;
        const lastY = tileRows(level) - 1;
        const first = await source.getTile({ level: index, x: 0, y: 0 });
        checkResult(source, first, ...edge(level, 0, 0));
        const last = await source.getTile({ level: index, x: lastX, y: lastY });
        checkResult(source, last, ...edge(level, lastX, lastY));
      }
    });

    it("returns a raster that equals the tiles it covers", async () => {
      const index = source.levels.findIndex(
        (level) => tileColumns(level) > 1 || tileRows(level) > 1,
      );
      const level = source.levels[Math.max(index, 0)];
      assert.ok(level !== undefined);
      const levelIndex = Math.max(index, 0);
      const x0 = Math.max(0, level.tileWidth - 8);
      const y0 = Math.max(0, level.tileHeight - 8);
      const x1 = Math.min(level.width, level.tileWidth + 8);
      const y1 = Math.min(level.height, level.tileHeight + 8);
      const raster = await source.getRaster({ level: levelIndex, window: [x0, y0, x1, y1] });
      checkResult(source, raster, x1 - x0, y1 - y0);
      if (raster.absent) return;
      for (let ty = 0; ty * level.tileHeight < y1; ty++) {
        for (let tx = 0; tx * level.tileWidth < x1; tx++) {
          const tile = await source.getTile({ level: levelIndex, x: tx, y: ty });
          if (tile.absent) continue;
          for (
            let y = Math.max(y0, ty * level.tileHeight);
            y < Math.min(y1, ty * level.tileHeight + tile.height);
            y++
          ) {
            for (
              let x = Math.max(x0, tx * level.tileWidth);
              x < Math.min(x1, tx * level.tileWidth + tile.width);
              x++
            ) {
              for (let channel = 0; channel < source.channels.length; channel++) {
                assert.equal(
                  sample(raster, channel, x - x0, y - y0),
                  sample(tile, channel, x - tx * level.tileWidth, y - ty * level.tileHeight),
                  `pixel ${x},${y} channel ${channel}`,
                );
              }
            }
          }
        }
      }
    });

    it("reads a whole coarsest level as one raster", async () => {
      const index = source.levels.length - 1;
      const level = source.levels[index];
      assert.ok(level !== undefined);
      const raster = await source.getRaster({ level: index });
      checkResult(source, raster, level.width, level.height);
    });

    it("refuses requests outside the pyramid", async () => {
      const level = source.levels[0];
      assert.ok(level !== undefined);
      await assert.rejects(source.getTile({ level: 0, x: tileColumns(level), y: 0 }), RangeError);
      await assert.rejects(source.getTile({ level: 0, x: 0, y: -1 }), RangeError);
      await assert.rejects(source.getTile({ level: source.levels.length, x: 0, y: 0 }), RangeError);
      await assert.rejects(
        source.getRaster({ level: 0, window: [0, 0, level.width + 1, 1] }),
        RangeError,
      );
    });

    it("rejects an aborted request", async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(source.getTile({ level: 0, x: 0, y: 0, signal: controller.signal }), {
        name: "AbortError",
      });
    });

    it("refuses reads after close", async () => {
      const reopened = await open();
      reopened.close();
      reopened.close();
      await assert.rejects(reopened.getTile({ level: 0, x: 0, y: 0 }), SourceClosedError);
    });
  });
}
