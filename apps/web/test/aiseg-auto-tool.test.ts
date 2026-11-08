import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aisInstances } from "../src/aiseg/ais-instances.ts";
import {
  createFakeReader,
  createFakeSam,
  fakeMapSize,
  fakeNucleusGrid,
} from "../src/aiseg/fake-sam.ts";
import { planRegionTiles, runRegionPass } from "../src/aiseg/region-pass.ts";
import { planPresetPatch } from "../src/aiseg/scale-presets.ts";
import {
  type SmartServices,
  type SmartServicesContext,
  shareServices,
} from "../src/aiseg/smart-services.ts";

const slide = { width: 20_000, height: 20_000 };
const plan = planPresetPatch([{ downsample: 1 }], null, "nuclei");

describe("auto region tool services", () => {
  it("offers the fake model a full set of AIS maps that outline every grid nucleus", async () => {
    const sam = createFakeSam();
    await sam.encode("a", new Float32Array(0));
    const outputs = await sam.segmentAll("a");
    const maps = outputs["maps"];
    assert.ok(maps !== undefined);
    assert.equal(maps.data.length, fakeMapSize * fakeMapSize * 3);
    assert.equal(
      aisInstances(maps.data, fakeMapSize, fakeMapSize).length,
      fakeNucleusGrid().length,
    );
  });

  it("hands the outline step to the caller instead of running it on the calling thread", async () => {
    const calls: number[] = [];
    const nuclei = await runRegionPass({
      tiles: planRegionTiles({ x: 1000, y: 1000, width: 700, height: 300 }, plan),
      preset: "nuclei",
      reader: createFakeReader(slide),
      sam: createFakeSam(),
      outline: (maps, width, height) => {
        calls.push(width);
        return Promise.resolve(aisInstances(maps, width, height));
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(nuclei.length > 0);
  });

  it("closes the shared services once the last holder closes them", async () => {
    let loads = 0;
    let closes = 0;
    const loader = shareServices(() => {
      loads += 1;
      const services: SmartServices = {
        reader: createFakeReader(slide),
        sam: createFakeSam(),
        plan: () => Promise.resolve(plan),
        close: () => {
          closes += 1;
        },
      };
      return Promise.resolve(services);
    });
    const context: SmartServicesContext = {
      slide,
      open: () => Promise.reject(new Error("unused")),
    };
    const first = await loader(context);
    const second = await loader(context);
    assert.equal(loads, 1);
    first.close();
    first.close();
    assert.equal(closes, 0);
    second.close();
    assert.equal(closes, 1);
    await loader(context);
    assert.equal(loads, 2);
  });
});
