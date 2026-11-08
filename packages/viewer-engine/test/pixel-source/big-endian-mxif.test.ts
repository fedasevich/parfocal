import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, describe, it } from "node:test";
import { syntheticDir } from "@parfocal/test-fixtures";
import { fromUrl } from "geotiff";
import {
  openTiffSource,
  type PixelResult,
  type Raster,
  readTileIndex,
  type SlideIndex,
} from "../../src/pixel-source/index.ts";
import { createVivChannelLevels } from "../../src/viv/index.ts";
import { serve } from "./serve.ts";

const mxif = "synthetic-mxif-uint16-be.ome.tiff";
const reference = "synthetic-channels-uint16.ome.tiff";
const goldenDir = new URL("../../../../workers/ingest/tests/golden/tile-index/", import.meta.url);
const width = 1024;
const height = 768;
const top = 65_535;

const served = await serve({ "/synthetic": syntheticDir });
after(() => served.close());

const open = (file: string, index?: SlideIndex) =>
  openTiffSource({
    formatId: "ome-tiff",
    url: served.url(`/synthetic/${file}`),
    ...(index === undefined ? {} : { index }),
  });

async function sidecar(): Promise<SlideIndex> {
  return readTileIndex(JSON.parse(await readFile(new URL(`${mxif}.json`, goldenDir), "utf8")));
}

function present(result: PixelResult): Raster {
  assert.ok(!result.absent, "expected a present raster");
  return result;
}

function fourthChannel(x: number, y: number): number {
  if (y >= height - 96 && y < height - 32 && x >= 32 && x < 160) return top;
  return ((x + y) / (width + height - 2)) * 0.9 * top;
}

describe("16-bit big-endian BigTIFF with the pyramid in SubIFDs (MxIF layout)", () => {
  it("raw geotiff misreads the deferred 64-bit tile offsets", async () => {
    const raw = await (await fromUrl(served.url(`/synthetic/${mxif}`))).getImage(0);
    assert.equal(raw.littleEndian, false);
    assert.ok(raw.fileDirectory.deferredArrays.has(324), "TileOffsets is deferred");
    await assert.rejects(raw.readRasters({ window: [0, 0, 64, 64] }), /MAX_SAFE_INTEGER/);
  });

  for (const route of ["walking the directories", "the ingest sidecar"] as const) {
    it(`reads exact 16-bit samples of every channel and level through ${route}`, async () => {
      const index = route === "the ingest sidecar" ? await sidecar() : undefined;
      const source = await open(mxif, index);
      const expected = await open(reference);
      assert.equal(source.dtype, "uint16");
      assert.equal(source.photometric, "channels");
      assert.deepEqual(
        source.channels.map((channel) => channel.name),
        ["Hoechst", "Laminin", "Synaptopodin", "THP"],
      );
      assert.deepEqual(source.micronsPerPixel, { x: 0.5, y: 0.5 });
      assert.equal(source.levels.length, 3);
      for (const level of [0, 1, 2]) {
        const window = [0, 0, 160, 120] as const;
        const ours = present(await source.getRaster({ level, window }));
        const theirs = present(await expected.getRaster({ level, window }));
        assert.equal(ours.planes.length, 4);
        for (const channel of [0, 1, 2])
          assert.deepEqual(ours.planes[channel], theirs.planes[channel], `level ${level}`);
      }
      const corner = present(await source.getRaster({ level: 0, window: [32, 32, 224, 96] }));
      assert.ok(
        corner.planes[0]?.every((value) => value === top),
        "Hoechst keeps its top bits",
      );
      const window = [0, height - 128, 192, height] as const;
      const fourth = present(await source.getRaster({ level: 0, window }))
        .planes[3] as ArrayLike<number>;
      for (let y = window[1]; y < window[3]; y++)
        for (let x = window[0]; x < window[2]; x++) {
          const value = fourth[(y - window[1]) * (window[2] - window[0]) + x - window[0]] ?? -1;
          assert.ok(Math.abs(value - fourthChannel(x, y)) <= 1, `THP at ${x}, ${y} is ${value}`);
        }
      source.close();
      expected.close();
    });
  }

  it("Viv draws the four channels at 16 bits", async () => {
    const viv = createVivChannelLevels(await open(mxif, await sidecar()));
    assert.equal(viv.dtype, "Uint16");
    assert.deepEqual(viv.levels[0]?.shape, [4, height, width]);
  });
});
