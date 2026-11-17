import assert from "node:assert/strict";
import { test } from "node:test";
import type { PixelSource, RasterRequest } from "../src/pixel-source/types.ts";
import { readSlideOverview, smallestLevel } from "../src/viv/slide-overview.ts";

const level = (width: number, height: number, downsample: number) => ({
  width,
  height,
  downsample,
  tileWidth: 256,
  tileHeight: 256,
});

function source(
  levels: ReturnType<typeof level>[],
  dtype = "uint8",
): {
  source: PixelSource;
  asked: RasterRequest[];
} {
  const asked: RasterRequest[] = [];
  return {
    asked,
    source: {
      formatId: "tiff",
      levels,
      tileSize: { width: 256, height: 256 },
      micronsPerPixel: null,
      photometric: "rgb",
      dtype,
      channels: [],
      getTile: () => Promise.reject(new Error("no tiles here")),
      getRaster: (request: RasterRequest) => {
        asked.push(request);
        const info = levels[request.level] ?? level(0, 0, 1);
        const count = info.width * info.height;
        return Promise.resolve({
          absent: false,
          width: info.width,
          height: info.height,
          planes: [
            new Uint8Array(count).fill(10),
            new Uint8Array(count).fill(20),
            new Uint8Array(count).fill(30),
          ],
        });
      },
      close: () => {},
    } as unknown as PixelSource,
  };
}

test("the overview reads the slide's smallest level as opaque RGBA", async () => {
  const slide = source([level(4000, 3000, 1), level(250, 200, 16), level(1000, 750, 4)]);
  assert.equal(smallestLevel(slide.source), 1);
  const overview = await readSlideOverview(slide.source);
  assert.ok(overview);
  assert.deepEqual([overview.width, overview.height], [250, 200]);
  assert.deepEqual([...overview.rgba.slice(0, 4)], [10, 20, 30, 255]);
  assert.deepEqual(
    slide.asked.map((request) => request.level),
    [1],
  );
});

test("a slide whose smallest level is too large or not 8 bit gives no overview", async () => {
  const large = source([level(90000, 60000, 1), level(9000, 6000, 10)]);
  assert.equal(await readSlideOverview(large.source), null);
  assert.deepEqual(large.asked, []);
  const deep = source([level(500, 400, 1)], "uint16");
  assert.equal(await readSlideOverview(deep.source), null);
});
