import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PixelLevel, PixelResult, RasterRequest } from "../../src/index.ts";
import {
  createPatchReader,
  locatePatch,
  PatchReaderClosedError,
  type PatchSource,
  patchHoldsPoint,
  planesToRgb,
  UnsupportedPatchError,
} from "../../src/index.ts";

const levels: PixelLevel[] = [
  { downsample: 1, width: 4000, height: 3000, tileWidth: 256, tileHeight: 256 },
  { downsample: 4, width: 1000, height: 750, tileWidth: 256, tileHeight: 256 },
];

interface FakeSource extends PatchSource {
  readonly requests: RasterRequest[];
}

function fakeSource(absent: (request: RasterRequest) => boolean = () => false): FakeSource {
  const requests: RasterRequest[] = [];
  return {
    requests,
    levels,
    micronsPerPixel: { x: 0.5, y: 0.5 },
    photometric: "rgb",
    dtype: "uint8",
    getRaster(request): Promise<PixelResult> {
      requests.push(request);
      const [x0, y0, x1, y1] = request.window ?? [0, 0, 1, 1];
      const width = x1 - x0;
      const height = y1 - y0;
      if (absent(request)) return Promise.resolve({ absent: true, width, height });
      const plane = (shift: number) => {
        const out = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++)
            out[y * width + x] = (x0 + x + (y0 + y) * 3 + shift) % 251;
        }
        return out;
      };
      return Promise.resolve({
        absent: false,
        width,
        height,
        planes: [plane(0), plane(10), plane(20)],
      });
    },
  };
}

describe("patch window", () => {
  it("centres on the point at the level and clamps to the slide", () => {
    const level = levels[0] as PixelLevel;
    assert.deepEqual(locatePatch(level, { level: 0, size: 256, x: 2000, y: 1500 }), {
      x: 1872,
      y: 1372,
      width: 256,
      height: 256,
    });
    assert.deepEqual(locatePatch(level, { level: 0, size: 256, x: 5, y: 3990 }), {
      x: 0,
      y: 2744,
      width: 256,
      height: 256,
    });
  });

  it("converts the level 0 point to level pixels", () => {
    const level = levels[1] as PixelLevel;
    const window = locatePatch(level, { level: 1, size: 64, x: 2000, y: 1200 });
    assert.equal(window.x, 500 - 32);
    assert.equal(window.y, 300 - 32);
  });

  it("shrinks the patch to a level smaller than it", () => {
    const small: PixelLevel = {
      downsample: 64,
      width: 40,
      height: 30,
      tileWidth: 40,
      tileHeight: 30,
    };
    assert.deepEqual(locatePatch(small, { level: 0, size: 256, x: 0, y: 0 }), {
      x: 0,
      y: 0,
      width: 40,
      height: 30,
    });
  });
});

describe("edge margin", () => {
  const patch = { x: 100, y: 100, width: 256, height: 256, downsample: 1 };
  const level = { width: 4000, height: 3000 };

  it("holds a point away from every edge by more than an eighth", () => {
    assert.ok(patchHoldsPoint(patch, level, 228, 228));
    assert.ok(patchHoldsPoint(patch, level, 100 + 33, 228));
    assert.ok(patchHoldsPoint(patch, level, 356 - 33, 228));
  });

  it("lets go of a point within an eighth of an edge or outside", () => {
    assert.ok(!patchHoldsPoint(patch, level, 100 + 31, 228));
    assert.ok(!patchHoldsPoint(patch, level, 356 - 31, 228));
    assert.ok(!patchHoldsPoint(patch, level, 228, 100 + 31));
    assert.ok(!patchHoldsPoint(patch, level, 228, 356 - 31));
    assert.ok(!patchHoldsPoint(patch, level, 50, 228));
  });

  it("does not ask for a margin on a side that sits on the slide edge", () => {
    const corner = { x: 0, y: 0, width: 256, height: 256, downsample: 1 };
    assert.ok(patchHoldsPoint(corner, level, 2, 2));
    assert.ok(!patchHoldsPoint(corner, level, 250, 100));
  });
});

describe("planes to RGB", () => {
  it("interleaves three planes", () => {
    const rgb = planesToRgb(
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      2,
      1,
    );
    assert.deepEqual([...rgb], [1, 3, 5, 2, 4, 6]);
  });

  it("repeats a single grey plane into all three channels", () => {
    assert.deepEqual([...planesToRgb([[7, 9]], 2, 1)], [7, 7, 7, 9, 9, 9]);
  });
});

describe("patch reader", () => {
  const query = { level: 0, size: 256, x: 2000, y: 1500 };

  it("reads the window as interleaved RGB", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source);
    const { patch, cacheHit, moved } = await reader.read(query);
    assert.equal(cacheHit, false);
    assert.equal(moved, false);
    assert.equal(patch.absent, false);
    assert.deepEqual(source.requests[0]?.window, [1872, 1372, 2128, 1628]);
    assert.equal(patch.rgb?.length, 256 * 256 * 3);
    assert.equal(patch.rgb?.[0], (1872 + 1372 * 3) % 251);
    assert.equal(patch.rgb?.[1], (1872 + 1372 * 3 + 10) % 251);
  });

  it("serves a repeat read from the cache without touching the slide", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source);
    const first = await reader.read(query);
    const second = await reader.read(query);
    assert.equal(second.cacheHit, true);
    assert.equal(second.patch, first.patch);
    assert.equal(source.requests.length, 1);
    assert.deepEqual(reader.stats(), { hits: 1, misses: 1, reads: 1, size: 1 });
  });

  it("keeps the patch for a click well inside it", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source);
    const first = await reader.read(query);
    const second = await reader.read({ ...query, x: 2060, y: 1440 });
    assert.equal(second.patch, first.patch);
    assert.equal(second.moved, false);
    assert.equal(source.requests.length, 1);
  });

  it("moves the patch for a click near its edge", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source);
    const first = await reader.read(query);
    const second = await reader.read({ ...query, x: 2128 - 20, y: 1500 });
    assert.equal(second.moved, true);
    assert.equal(second.cacheHit, false);
    assert.notEqual(second.patch.key, first.patch.key);
    assert.equal(second.patch.x, 2108 - 128);
    assert.ok(patchHoldsPoint(second.patch, levels[0] as PixelLevel, 2108, 1500));
    assert.equal(source.requests.length, 2);
  });

  it("finds an earlier patch again after the anchor moved", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source);
    await reader.read(query);
    await reader.read({ ...query, x: 2000 + 1000 });
    const back = await reader.read(query);
    assert.equal(back.cacheHit, true);
    assert.equal(back.moved, true);
    assert.equal(source.requests.length, 2);
  });

  it("drops the least recently used patch past the cache size", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source, { cacheSize: 2 });
    await reader.read({ ...query, x: 500 });
    await reader.read({ ...query, x: 1500 });
    await reader.read({ ...query, x: 2500 });
    assert.equal(reader.stats().size, 2);
    const again = await reader.read({ ...query, x: 500 });
    assert.equal(again.cacheHit, false);
    assert.equal(source.requests.length, 4);
  });

  it("flags a patch in a sparse region as absent and caches the answer", async () => {
    const source = fakeSource(() => true);
    const reader = createPatchReader(source);
    const first = await reader.read(query);
    assert.equal(first.patch.absent, true);
    assert.equal(first.patch.rgb, null);
    const second = await reader.read(query);
    assert.equal(second.cacheHit, true);
    assert.equal(source.requests.length, 1);
  });

  it("shares one slide read between concurrent requests for the same patch", async () => {
    const source = fakeSource();
    const reader = createPatchReader(source);
    const [a, b] = await Promise.all([reader.read(query), reader.read(query)]);
    assert.equal(a.patch, b.patch);
    assert.equal(source.requests.length, 1);
  });

  it("refuses a level the slide does not have", async () => {
    const reader = createPatchReader(fakeSource());
    await assert.rejects(reader.read({ ...query, level: 5 }), RangeError);
  });

  it("refuses slides that are not 8-bit", () => {
    assert.throws(
      () => createPatchReader({ ...fakeSource(), dtype: "uint16" }),
      UnsupportedPatchError,
    );
  });

  it("refuses reads after close", async () => {
    const reader = createPatchReader(fakeSource());
    reader.close();
    await assert.rejects(reader.read(query), PatchReaderClosedError);
  });
});
