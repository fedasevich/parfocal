import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  convertedDir,
  fixturesDir,
  skipUnlessCached,
  skipUnlessConverted,
} from "@parfocal/test-fixtures";
import {
  createDefaultPixelSourceRegistry,
  nativeAgreementThreshold,
  openOmeZarrSource,
  type PixelSource,
  type Raster,
} from "../../src/index.ts";
import { meanAbsoluteError } from "../../src/pixel-source/tiff/native-jpeg.ts";
import { type Expected, pixelSourceConformance } from "./conformance.ts";
import { serve } from "./serve.ts";

const slide = "CMU-1-Small-Region.svs";
const jpegStore = "CMU-1-Small-Region.ome.zarr";
const zstdStore = "CMU-1-Small-Region-zstd.ome.zarr";
const windows: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 512, 512],
  [1024, 1536, 1536, 2048],
  [1708, 2455, 2220, 2967],
];

const expected: Expected = {
  levels: 4,
  photometric: "rgb",
  dtype: "uint8",
  micronsPerPixel: 0.499,
  levelSizes: ["1 2220x2967", "2 1110x1483", "4 555x741", "8 277x370"],
};

const skip =
  skipUnlessCached(slide) || skipUnlessConverted(jpegStore) || skipUnlessConverted(zstdStore);

function present(raster: Awaited<ReturnType<PixelSource["getRaster"]>>): Raster {
  assert.equal(raster.absent, false);
  if (raster.absent) throw new Error("absent raster");
  return raster;
}

function halvedExactly(finer: Raster, width: number, height: number): number[][] {
  return finer.planes.map((plane) => {
    const out: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = 2 * y * finer.width + 2 * x;
        const sum =
          (plane[at] ?? 0) +
          (plane[at + 1] ?? 0) +
          (plane[at + finer.width] ?? 0) +
          (plane[at + finer.width + 1] ?? 0);
        const quotient = sum >> 2;
        const rest = sum & 3;
        out.push(rest < 2 ? quotient : rest > 2 ? quotient + 1 : quotient + (quotient & 1));
      }
    }
    return out;
  });
}

if (skip !== false) {
  describe("OME-Zarr 0.5 stores converted from a real slide", () => it("reads them", { skip }));
} else {
  const served = await serve({ "/cache": fixturesDir(), "/converted": convertedDir() });
  after(() => served.close());

  const open = (store: string) =>
    openOmeZarrSource({ formatId: "ome-zarr", url: served.url(`/converted/${store}`) });
  const openSlide = () =>
    createDefaultPixelSourceRegistry().open({
      formatId: "aperio-svs",
      url: served.url(`/cache/${slide}`),
    });

  pixelSourceConformance(`zarrita, ${jpegStore} (JPEG chunks)`, () => open(jpegStore), expected);
  pixelSourceConformance(`zarrita, ${zstdStore} (zstd chunks)`, () => open(zstdStore), expected);

  describe(`${slide} converted to OME-Zarr 0.5`, () => {
    it("keeps the JPEG chunks within the agreement threshold of the source slide", async () => {
      const source = await openSlide();
      const store = await open(jpegStore);
      for (const window of windows) {
        const reference = present(await source.getRaster({ level: 0, window: [...window] }));
        const actual = present(await store.getRaster({ level: 0, window: [...window] }));
        const error = meanAbsoluteError(actual.planes, reference.planes);
        assert.ok(error <= nativeAgreementThreshold, `${window.join(",")} differs by ${error}`);
        assert.ok(error > 0, `${window.join(",")} is lossy`);
      }
      source.close();
      store.close();
    });

    it("keeps the zstd chunks within one grey level of the source slide as decoded here", async () => {
      const source = await openSlide();
      const store = await open(zstdStore);
      for (const window of windows) {
        const reference = present(await source.getRaster({ level: 0, window: [...window] }));
        const actual = present(await store.getRaster({ level: 0, window: [...window] }));
        let largest = 0;
        for (const [channel, plane] of actual.planes.entries()) {
          const other = reference.planes[channel];
          for (const [at, value] of plane.entries()) {
            largest = Math.max(largest, Math.abs(value - (other?.[at] ?? 0)));
          }
        }
        assert.ok(largest <= 1, `${window.join(",")} differs by up to ${largest}`);
      }
      source.close();
      store.close();
    });

    it("reads the coarsest zstd level as the exact 2 by 2 mean of the level above", async () => {
      const store = await open(zstdStore);
      const coarsest = store.levels.length - 1;
      const { width, height } = store.levels[coarsest] ?? { width: 0, height: 0 };
      const finer = present(
        await store.getRaster({ level: coarsest - 1, window: [0, 0, width * 2, height * 2] }),
      );
      const actual = present(await store.getRaster({ level: coarsest }));
      const expectedPlanes = halvedExactly(finer, width, height);
      for (const [channel, plane] of actual.planes.entries()) {
        assert.deepEqual(Array.from(plane), expectedPlanes[channel], `channel ${channel}`);
      }
      store.close();
    });

    it("keeps every JPEG level within the agreement threshold of the zstd level", async () => {
      const jpeg = await open(jpegStore);
      const zstd = await open(zstdStore);
      for (const [level, { width, height }] of jpeg.levels.entries()) {
        const window: [number, number, number, number] = [
          0,
          0,
          Math.min(width, 512),
          Math.min(height, 512),
        ];
        const lossy = present(await jpeg.getRaster({ level, window }));
        const exact = present(await zstd.getRaster({ level, window }));
        const error = meanAbsoluteError(lossy.planes, exact.planes);
        assert.ok(error <= nativeAgreementThreshold, `level ${level} differs by ${error}`);
      }
      jpeg.close();
      zstd.close();
    });

    it("reports which decoder read each store", async () => {
      const jpeg = await open(jpegStore);
      await jpeg.getTile({ level: 0, x: 0, y: 0 });
      assert.equal((await jpeg.decodeReport?.())?.jpeg, "script");
      jpeg.close();
      const zstd = await open(zstdStore);
      await zstd.getTile({ level: 0, x: 0, y: 0 });
      assert.equal((await zstd.decodeReport?.())?.jpeg, "none");
      zstd.close();
    });
  });
}
