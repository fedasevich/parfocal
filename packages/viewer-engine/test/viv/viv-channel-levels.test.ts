import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { openTiffSource, type PixelResult, type Raster } from "../../src/index.ts";
import {
  boxDownsamplePlane,
  createVivChannelLevels,
  createVivLevels,
  UnsupportedVivSourceError,
  vivChannelDtype,
  vivChannelLayerProps,
} from "../../src/viv/index.ts";
import { vivSignalAborted } from "../../src/viv/viv-levels.ts";
import { syntheticDir } from "../pixel-source/fixtures.ts";
import { serve } from "../pixel-source/serve.ts";

const served = await serve({ "/synthetic": syntheticDir });

after(async () => {
  await served.close();
});

const open = (file: string, formatId: "generic-tiff" | "ome-tiff" = "ome-tiff") =>
  openTiffSource({ formatId, url: served.url(`/synthetic/${file}`) });

function present(result: PixelResult): Raster {
  assert.ok(!result.absent, "expected a present raster");
  return result;
}

describe("Viv levels over a multichannel PixelSource", () => {
  it("describes a 16-bit channel stack as c, y, x levels (synthetic-channels-uint16.ome.tiff)", async () => {
    const source = await open("synthetic-channels-uint16.ome.tiff");
    const viv = createVivChannelLevels(source);
    assert.equal(viv.dtype, "Uint16");
    assert.equal(viv.tileSize, 256);
    const [base] = viv.levels;
    assert.ok(base !== undefined);
    assert.deepEqual(base.shape, [3, 768, 1024]);
    assert.deepEqual(base.labels, ["c", "y", "x"]);
    assert.equal(base.dtype, "Uint16");
    assert.deepEqual(
      viv.ladder.map((level) => level.downsample),
      [1, 2, 4],
    );
    source.close();
  });

  it("returns the samples of the selected channel only, at their own bit depth", async () => {
    for (const [file, array] of [
      ["synthetic-channels-uint8.ome.tiff", Uint8Array],
      ["synthetic-channels-uint16.ome.tiff", Uint16Array],
    ] as const) {
      const source = await open(file);
      const viv = createVivChannelLevels(source);
      const raster = present(await source.getRaster({ level: 0, window: [256, 256, 512, 512] }));
      for (let c = 0; c < 3; c++) {
        const tile = await viv.levels[0]?.getTile({ x: 1, y: 1, selection: { c } });
        assert.ok(tile !== undefined);
        assert.ok(tile.data instanceof array);
        assert.equal(tile.width, 256);
        assert.deepEqual(Array.from(tile.data), Array.from(raster.planes[c] ?? []));
      }
      source.close();
    }
  });

  it("averages the backing level for a level between two stored ones", async () => {
    const source = await open("synthetic-channels-uint16.ome.tiff");
    const viv = createVivChannelLevels(source);
    const coarse = viv.levels[2];
    assert.ok(coarse !== undefined);
    const tile = await coarse.getTile({ x: 0, y: 0, selection: { c: 1 } });
    const stored = present(await source.getRaster({ level: 2, window: [0, 0, 256, 192] }));
    assert.equal(tile.width, 256);
    assert.equal(tile.height, 192);
    assert.deepEqual(Array.from(tile.data), Array.from(stored.planes[1] ?? []));
    source.close();
  });

  it("rounds a block mean half up and keeps short edge blocks", () => {
    const plane = Uint16Array.from([1, 2, 3, 65_535, 0, 0, 0, 0, 7, 8, 9, 9]);
    const out = boxDownsamplePlane(plane, "Uint16", 4, 3, 2, 2, 2);
    assert.deepEqual(Array.from(out), [1, 16_385, 8, 9]);
  });

  it("rejects a channel, a tile or an aborted request that the slide cannot serve", async () => {
    const source = await open("synthetic-channels-uint16.ome.tiff");
    const viv = createVivChannelLevels(source);
    const base = viv.levels[0];
    assert.ok(base !== undefined);
    await assert.rejects(base.getTile({ x: 0, y: 0, selection: { c: 3 } }), RangeError);
    await assert.rejects(base.getTile({ x: 4, y: 0, selection: { c: 0 } }), RangeError);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      base.getTile({ x: 0, y: 0, selection: { c: 0 }, signal: controller.signal }),
      (error: unknown) => error === vivSignalAborted,
    );
    assert.equal(viv.pending(), 0);
    source.close();
  });

  it("refuses an RGB slide and keeps the RGB levels for it, and the reverse", async () => {
    const rgb = await open("synthetic-zlib.ome.tiff");
    assert.throws(() => createVivChannelLevels(rgb), UnsupportedVivSourceError);
    const channels = await open("synthetic-channels-uint16.ome.tiff");
    assert.throws(() => createVivLevels(channels), UnsupportedVivSourceError);
    assert.throws(() => vivChannelDtype({ dtype: "float32" }), UnsupportedVivSourceError);
    rgb.close();
    channels.close();
  });

  it("builds Viv layer props from the channel colours and the sample range", async () => {
    const source = await open("synthetic-channels-uint16.ome.tiff");
    const viv = createVivChannelLevels(source);
    const props = vivChannelLayerProps(viv, [{ contrast: [1000, 70_000] }, { visible: false }]);
    assert.deepEqual(props.selections, [
      { c: 0, z: 0, t: 0 },
      { c: 1, z: 0, t: 0 },
      { c: 2, z: 0, t: 0 },
    ]);
    assert.deepEqual(props.contrastLimits, [
      [1000, 65_535],
      [0, 65_535],
      [0, 65_535],
    ]);
    assert.deepEqual(props.colors, [
      [0, 0, 255],
      [0, 255, 0],
      [255, 0, 0],
    ]);
    assert.deepEqual(props.channelsVisible, [true, false, true]);
    assert.equal(props.dtype, "Uint16");
    source.close();
  });
});
