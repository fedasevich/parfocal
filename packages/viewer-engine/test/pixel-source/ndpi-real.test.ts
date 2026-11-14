import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { fixturesDir, skipUnlessCached } from "@parfocal/test-fixtures";
import {
  openNdpiSource,
  type PixelSource,
  type PixelWindow,
  type SlideIndex,
} from "../../src/index.ts";
import { ndpiIndexOf } from "./ndpi-index.ts";
import { serve } from "./serve.ts";

const fourGigabytes = 2 ** 32;
const served = await serve({ "/cache": fixturesDir() });
after(() => served.close());

interface Watched {
  readonly fetch: typeof globalThis.fetch;
  requests: number;
  highest: number;
}

function watched(): Watched {
  const state: Watched = {
    requests: 0,
    highest: 0,
    fetch: (input, init) => {
      const start = /bytes=(\d+)-/.exec(new Headers(init?.headers).get("range") ?? "");
      state.requests++;
      if (start) state.highest = Math.max(state.highest, Number(start[1]));
      return fetch(input, init);
    },
  };
  return state;
}

function open(name: string, watch: Watched, index?: SlideIndex): Promise<PixelSource> {
  return openNdpiSource({
    formatId: "hamamatsu-ndpi",
    url: served.url(`/cache/${name}`),
    fetch: watch.fetch,
    nativeJpeg: "off",
    ...(index === undefined ? {} : { index }),
  });
}

function shapes(source: PixelSource): number[][] {
  return source.levels.map((level) => [level.width, level.height, level.downsample]);
}

function bottomRight(source: PixelSource, level: number): PixelWindow {
  const { width, height } = source.levels[level] ?? { width: 0, height: 0 };
  return [Math.max(0, width - 300), Math.max(0, height - 200), width, height];
}

async function samples(source: PixelSource, level: number, window: PixelWindow) {
  const raster = await source.getRaster({ level, window });
  assert.equal(raster.absent, false);
  if (raster.absent) throw new Error("absent");
  assert.equal(raster.width, window[2] - window[0]);
  assert.equal(raster.height, window[3] - window[1]);
  return raster.planes.map((plane) => Array.from(plane));
}

function spread(planes: readonly (readonly number[])[]): number {
  const values = planes.flat();
  return Math.max(...values) - Math.min(...values);
}

interface RealSlide {
  readonly name: string;
  readonly levels: readonly (readonly number[])[];
  readonly micronsPerPixel: { readonly x: number; readonly y: number };
  readonly tissue: PixelWindow;
  readonly aboveFourGigabytes: boolean;
}

const slides: readonly RealSlide[] = [
  {
    name: "CMU-1.ndpi",
    levels: [
      [51200, 38144, 1],
      [12800, 9536, 4],
      [3200, 2384, 16],
      [800, 596, 64],
    ],
    micronsPerPixel: { x: 0.45641259698767683, y: 0.4550625711035267 },
    tissue: [34688, 19040, 34944, 19104],
    aboveFourGigabytes: false,
  },
  {
    name: "Hamamatsu-1.ndpi",
    levels: [
      [188160, 101376, 1],
      [94080, 50688, 2],
      [47040, 25344, 4],
      [23520, 12672, 8],
      [11760, 6336, 16],
      [5880, 3168, 32],
    ],
    micronsPerPixel: { x: 0.23026088558336597, y: 0.23029800561927133 },
    tissue: [30592, 50656, 30848, 50720],
    aboveFourGigabytes: true,
  },
];

for (const slide of slides) {
  describe(`NDPI source on ${slide.name}`, { skip: skipUnlessCached(slide.name) }, () => {
    it("reads the level sizes and the scale OpenSlide reports", async () => {
      const source = await open(slide.name, watched());
      assert.deepEqual(shapes(source), slide.levels);
      assert.deepEqual(source.micronsPerPixel, slide.micronsPerPixel);
      assert.equal(source.photometric, "rgb");
      source.close();
    });

    it("reads tissue at full resolution and the last rows of every level", async () => {
      const watch = watched();
      const source = await open(slide.name, watch);
      assert.ok(spread(await samples(source, 0, slide.tissue)) > 60);
      for (const level of source.levels.keys()) {
        watch.highest = 0;
        await samples(source, level, bottomRight(source, level));
        if (slide.aboveFourGigabytes) {
          assert.ok(watch.highest > fourGigabytes, `level ${level} read at ${watch.highest}`);
        }
      }
      source.close();
    });

    it("reads the same pixels from a slide index without walking the directories", async () => {
      const walkWatch = watched();
      const walked = await open(slide.name, walkWatch);
      const walkRequests = walkWatch.requests;
      const index = await ndpiIndexOf(
        served.url(`/cache/${slide.name}`),
        fetch,
        slide.micronsPerPixel,
      );
      const indexWatch = watched();
      const indexed = await open(slide.name, indexWatch, index);
      assert.ok(indexWatch.requests <= 1, `${indexWatch.requests} requests to open`);
      assert.ok(walkRequests > indexWatch.requests);
      assert.deepEqual(shapes(indexed), slide.levels);
      assert.deepEqual(indexed.micronsPerPixel, slide.micronsPerPixel);
      assert.deepEqual(
        await samples(indexed, 0, slide.tissue),
        await samples(walked, 0, slide.tissue),
      );
      for (const level of walked.levels.keys()) {
        const window = bottomRight(walked, level);
        assert.deepEqual(
          await samples(indexed, level, window),
          await samples(walked, level, window),
        );
      }
      walked.close();
      indexed.close();
    });

    it("reads the same pixels from the ingest sidecar when one is given", {
      skip: process.env.NDPI_SIDECAR_DIR === undefined && "NDPI_SIDECAR_DIR is not set",
    }, async () => {
      const index = JSON.parse(
        readFileSync(`${process.env.NDPI_SIDECAR_DIR}/${slide.name}.tile-index.json`, "utf8"),
      ) as SlideIndex;
      const watch = watched();
      const indexed = await open(slide.name, watch, index);
      assert.ok(watch.requests <= 1, `${watch.requests} requests to open`);
      const walked = await open(slide.name, watched());
      assert.deepEqual(shapes(indexed), slide.levels);
      assert.deepEqual(indexed.micronsPerPixel, walked.micronsPerPixel);
      assert.deepEqual(
        await samples(indexed, 0, slide.tissue),
        await samples(walked, 0, slide.tissue),
      );
      for (const level of walked.levels.keys()) {
        const window = bottomRight(walked, level);
        assert.deepEqual(
          await samples(indexed, level, window),
          await samples(walked, level, window),
        );
      }
      walked.close();
      indexed.close();
    });
  });
}
