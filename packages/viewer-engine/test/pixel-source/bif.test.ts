import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDefaultPixelSourceRegistry,
  type PixelResult,
  type PixelSource,
} from "../../src/index.ts";
import {
  bifDownsamples,
  bifFrames,
  isTissueMark,
  scenePixel,
  stitchedSize,
  storedSize,
  tissueSpot,
  virtualBif,
} from "./bif-fixture.ts";

const registry = createDefaultPixelSourceRegistry();
const file = virtualBif();

function open(withIndex = true): Promise<PixelSource> {
  return registry.open({
    formatId: "ventana-bif",
    url: "http://slides.test/virtual.bif",
    fetch: file.fetch,
    ...(withIndex ? { index: file.index } : {}),
  });
}

function pixelAt(result: PixelResult, x: number, y: number): number[] {
  if (result.absent) return [];
  return result.planes.map((plane) => Number(plane[y * result.width + x]));
}

function markedPixels(result: PixelResult): number {
  let count = 0;
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const [r = -1, g = -1, b = -1] = pixelAt(result, x, y);
      if (isTissueMark(r, g, b)) count++;
    }
  }
  return count;
}

function wrongPixels(result: PixelResult, downsample: number, left = 0, top = 0): number {
  let wrong = 0;
  for (let y = 0; y < result.height; y++) {
    for (let x = 0; x < result.width; x++) {
      const expected = scenePixel((left + x) * downsample, (top + y) * downsample);
      const found = pixelAt(result, x, y);
      if (expected.some((value, channel) => value !== found[channel])) wrong++;
    }
  }
  return wrong;
}

describe("Ventana BIF through the default registry", () => {
  it("reports the stitched size on every level and the frame as the tile", async () => {
    const source = await open();
    assert.equal(source.formatId, "ventana-bif");
    assert.deepEqual(
      source.levels.map((level) => [level.downsample, level.width, level.height]),
      bifDownsamples.map((downsample) => [
        downsample,
        stitchedSize.width / downsample,
        stitchedSize.height / downsample,
      ]),
    );
    assert.deepEqual(source.tileSize, {
      width: bifFrames.frameWidth,
      height: bifFrames.frameHeight,
    });
    source.close();
  });

  it("shows the tissue in a frame overlap once and rebuilds the scanned scene", async () => {
    const source = await open();
    const whole = await source.getRaster({ level: 0 });
    assert.equal(whole.width, stitchedSize.width);
    assert.equal(whole.height, stitchedSize.height);
    assert.equal(wrongPixels(whole, 1), 0);
    assert.equal(markedPixels(whole), tissueSpot.width * tissueSpot.height);
    source.close();
  });

  it("stitches the downsampled level on the same positions", async () => {
    const source = await open();
    const whole = await source.getRaster({ level: 1 });
    assert.equal(whole.width, stitchedSize.width / 2);
    assert.equal(whole.height, stitchedSize.height / 2);
    assert.equal(wrongPixels(whole, 2), 0);
    assert.equal(markedPixels(whole), (tissueSpot.width * tissueSpot.height) / 4);
    source.close();
  });

  it("serves tiles that cross frame joints without repeating a column or row", async () => {
    const source = await open();
    const columns = Math.ceil(stitchedSize.width / bifFrames.frameWidth);
    const rows = Math.ceil(stitchedSize.height / bifFrames.frameHeight);
    let marked = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const tile = await source.getTile({ level: 0, x, y });
        assert.equal(tile.absent, false);
        assert.equal(wrongPixels(tile, 1, x * bifFrames.frameWidth, y * bifFrames.frameHeight), 0);
        marked += markedPixels(tile);
      }
    }
    assert.equal(marked, tissueSpot.width * tissueSpot.height);
    source.close();
  });

  it("the same file without stitching repeats the overlap tissue in all four frames", async () => {
    const source = await open(false);
    assert.equal(source.levels[0]?.width, storedSize.width);
    assert.equal(source.levels[0]?.height, storedSize.height);
    const whole = await source.getRaster({ level: 0 });
    assert.equal(markedPixels(whole), 4 * tissueSpot.width * tissueSpot.height);
    source.close();
  });
});
