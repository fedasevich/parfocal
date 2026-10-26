import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { openTiffSource, type PixelResult, type Raster } from "../../src/index.ts";
import { parseOmeChannels } from "../../src/pixel-source/tiff/ome-channels.ts";
import { syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";

const served = await serve({ "/synthetic": syntheticDir });

after(async () => {
  await served.close();
});

function present(result: PixelResult): Raster {
  assert.ok(!result.absent, "expected a present raster");
  return result;
}

const open = (file: string) =>
  openTiffSource({ formatId: "ome-tiff", url: served.url(`/synthetic/${file}`) });

const top = (dtype: "uint8" | "uint16") => (dtype === "uint8" ? 255 : 65535);

for (const dtype of ["uint8", "uint16"] as const) {
  describe(`OME-TIFF with separate ${dtype} channel planes`, () => {
    const file = `synthetic-channels-${dtype}.ome.tiff`;

    it("lists the three channels with their names and colours", async () => {
      const source = await open(file);
      assert.equal(source.photometric, "channels");
      assert.equal(source.dtype, dtype);
      assert.deepEqual(
        source.channels.map((channel) => [channel.name, channel.color]),
        [
          ["DAPI", [0, 0, 255]],
          ["FITC", [0, 255, 0]],
          ["TRITC", [255, 0, 0]],
        ],
      );
      assert.deepEqual(
        source.levels.map((level) => `${level.downsample} ${level.width}x${level.height}`),
        ["1 1024x768", "2 512x384", "4 256x192"],
      );
      source.close();
    });

    it("returns each channel's own pixels, with the full range of the sample type", async () => {
      const source = await open(file);
      const tile = present(await source.getRaster({ level: 0, window: [32, 32, 224, 96] }));
      const [dapi, fitc, tritc] = tile.planes;
      assert.ok(dapi !== undefined && fitc !== undefined && tritc !== undefined);
      assert.ok(
        dapi.every((sample) => sample === top(dtype)),
        "the DAPI block is saturated",
      );
      assert.ok(fitc.some((sample) => sample < top(dtype) * 0.2));
      const corner = present(await source.getRaster({ level: 0, window: [896, 608, 992, 736] }));
      assert.ok(corner.planes[1]?.every((sample) => sample === Math.round(top(dtype) * 0.8)));
      assert.ok(corner.planes[0]?.every((sample) => sample < top(dtype) * 0.6));
      source.close();
    });

    it("keeps the channels of a coarse level aligned with the base", async () => {
      const source = await open(file);
      const base = present(await source.getRaster({ level: 0, window: [0, 0, 512, 512] }));
      const half = present(await source.getRaster({ level: 1, window: [0, 0, 256, 256] }));
      for (let channel = 0; channel < 3; channel++) {
        let baseTotal = 0;
        let halfTotal = 0;
        for (const sample of base.planes[channel] ?? []) baseTotal += sample;
        for (const sample of half.planes[channel] ?? []) halfTotal += sample;
        const baseMean = baseTotal / (512 * 512);
        const halfMean = halfTotal / (256 * 256);
        assert.ok(Math.abs(baseMean - halfMean) < top(dtype) * 0.01, `channel ${channel}`);
      }
      source.close();
    });
  });
}

describe("OME channel XML", () => {
  it("reads names, colours and the entity escapes of an OME description", () => {
    const xml = `<OME><Image><Pixels SizeC="2" SizeZ="1" SizeT="1" DimensionOrder="XYCZT">
      <Channel ID="Channel:0:0" Name="CD3 &amp; CD8" Color="-16776961" SamplesPerPixel="1"/>
      <Channel ID="Channel:0:1" SamplesPerPixel="1"/></Pixels></OME>`;
    assert.deepEqual(parseOmeChannels(xml), [
      { name: "CD3 & CD8", color: [255, 0, 0], window: null },
      { name: "Channel 2", color: [0, 255, 0], window: null },
    ]);
  });

  it("returns nothing for one channel, interleaved samples or a Z and T stack in another order", () => {
    const pixels = (attributes: string) =>
      `<OME><Image><Pixels ${attributes}><Channel SamplesPerPixel="1"/></Pixels></OME>`;
    assert.equal(parseOmeChannels(pixels('SizeC="1"')), null);
    assert.equal(
      parseOmeChannels(
        '<Pixels SizeC="3"><Channel SamplesPerPixel="3"/><Channel SamplesPerPixel="3"/><Channel SamplesPerPixel="3"/></Pixels>',
      ),
      null,
    );
    assert.equal(
      parseOmeChannels(pixels('SizeC="3" SizeZ="4" SizeT="1" DimensionOrder="XYZCT"')),
      null,
    );
    assert.notEqual(
      parseOmeChannels(pixels('SizeC="3" SizeZ="4" SizeT="1" DimensionOrder="XYCZT"')),
      null,
    );
  });
});
