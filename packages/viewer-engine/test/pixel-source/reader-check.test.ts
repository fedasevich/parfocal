import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { referenceTilesDir } from "@parfocal/test-fixtures";
import { PNG } from "pngjs";
import {
  checkAgainstReference,
  checkSeams,
  openTiffSource,
  type PixelResult,
  type PixelSource,
  type PixelWindow,
  type RasterRequest,
  type ReaderFindingKind,
  type ReferenceWindow,
  rgbFromInterleaved,
  type SlideFormatId,
} from "../../src/index.ts";
import { cachedFixture, cachedFixtureDir, syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";

const served = await serve({ "/synthetic": syntheticDir, "/cache": cachedFixtureDir() });
after(() => served.close());

interface Slide {
  readonly name: string;
  readonly formatId: SlideFormatId;
  readonly cached: boolean;
}

const slides: readonly Slide[] = [
  { name: "synthetic-jpeg.tiff", formatId: "generic-tiff", cached: false },
  { name: "synthetic-zlib.ome.tiff", formatId: "ome-tiff", cached: false },
  { name: "synthetic-big-endian.tiff", formatId: "generic-tiff", cached: false },
  { name: "CMU-1-Small-Region.svs", formatId: "aperio-svs", cached: true },
  { name: "JP2K-33003-1.svs", formatId: "aperio-svs", cached: true },
  { name: "CMU-1.svs", formatId: "aperio-svs", cached: true },
];

function slide(name: string): Slide {
  const found = slides.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`${name} is not a reference slide`);
  return found;
}

function available(entry: Slide): boolean {
  return !entry.cached || cachedFixture(entry.name) !== null;
}

function skipUnless(entry: Slide): { skip?: string } {
  return available(entry) ? {} : { skip: `${entry.name} is not downloaded` };
}

async function open(entry: Slide): Promise<PixelSource> {
  const url = served.url(`/${entry.cached ? "cache" : "synthetic"}/${entry.name}`);
  return openTiffSource({ formatId: entry.formatId, url, nativeJpeg: "off" });
}

function reference(name: string): ReferenceWindow[] {
  const dir = join(referenceTilesDir, name);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    windows: (Omit<ReferenceWindow, "image"> & { file: string })[];
  };
  return manifest.windows.map(({ file, ...window }) => {
    const png = PNG.sync.read(readFileSync(join(dir, file)));
    return { ...window, image: rgbFromInterleaved(png.width, png.height, png.data, 4) };
  });
}

type RasterRewrite = (
  source: PixelSource,
  request: RasterRequest & { level: number; window: PixelWindow },
) => Promise<PixelResult>;

function broken(source: PixelSource, rewrite: RasterRewrite): PixelSource {
  return {
    ...source,
    getTile: source.getTile.bind(source),
    getRaster: (request) => {
      const level = source.levels[request.level];
      const window = request.window ?? [0, 0, level?.width ?? 0, level?.height ?? 0];
      return rewrite(source, { ...request, window });
    },
    close: source.close.bind(source),
  };
}

function mapPlanes(result: PixelResult, map: (r: number, g: number, b: number) => number[]) {
  if (result.absent) return result;
  const [red, green, blue] = result.planes;
  const size = result.width * result.height;
  const planes = [0, 1, 2].map(() => new Uint8Array(size));
  for (let index = 0; index < size; index++) {
    const mapped = map(red?.[index] ?? 0, green?.[index] ?? 0, blue?.[index] ?? 0);
    for (let channel = 0; channel < 3; channel++) {
      const plane = planes[channel] as Uint8Array;
      plane[index] = Math.round(Math.min(255, Math.max(0, mapped[channel] ?? 0)));
    }
  }
  return { ...result, planes };
}

const ycbcrShownAsRgb: RasterRewrite = async (source, request) =>
  mapPlanes(await source.getRaster(request), (r, g, b) => [
    0.299 * r + 0.587 * g + 0.114 * b,
    128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  ]);

const redAndBlueSwapped: RasterRewrite = async (source, request) =>
  mapPlanes(await source.getRaster(request), (r, g, b) => [b, g, r]);

function displaced(dx: number, dy: number): RasterRewrite {
  return (source, request) => {
    const [x0, y0, x1, y1] = request.window;
    return source.getRaster({ ...request, window: [x0 + dx, y0 + dy, x1 + dx, y1 + dy] });
  };
}

function relabelled(source: PixelSource, downsamples: readonly number[]): PixelSource {
  const levels = source.levels.map((level, index) => ({
    ...level,
    downsample: downsamples[index] ?? level.downsample,
  }));
  return { ...source, levels, getRaster: source.getRaster.bind(source) };
}

function overlappingFrames(overlap: number): RasterRewrite {
  return async (source, request) => {
    const level = source.levels[request.level];
    if (level === undefined) throw new Error("no level");
    const [x0, y0, x1, y1] = request.window;
    const sourceX = (x: number) => Math.max(0, x - Math.floor(x / level.tileWidth) * overlap);
    const sourceY = (y: number) => Math.max(0, y - Math.floor(y / level.tileHeight) * overlap);
    const left = sourceX(x0);
    const top = sourceY(y0);
    const right = Math.min(level.width, x1);
    const bottom = Math.min(level.height, y1);
    const read = await source.getRaster({ ...request, window: [left, top, right, bottom] });
    if (read.absent) return read;
    const width = x1 - x0;
    const height = y1 - y0;
    const planes = read.planes.map((plane) => {
      const out = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        const row = (sourceY(y0 + y) - top) * read.width;
        for (let x = 0; x < width; x++)
          out[y * width + x] = Number(plane[row + sourceX(x0 + x) - left]);
      }
      return out;
    });
    return { absent: false, width, height, planes };
  };
}

function hash(x: number, y: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, cell: number): number {
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  const fx = x / cell - cx;
  const fy = y / cell - cy;
  const top = hash(cx, cy) * (1 - fx) + hash(cx + 1, cy) * fx;
  const bottom = hash(cx, cy + 1) * (1 - fx) + hash(cx + 1, cy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

function texturedSource(width: number, height: number, tile: number): PixelSource {
  const level = { downsample: 1, width, height, tileWidth: tile, tileHeight: tile };
  const getRaster = (request: RasterRequest): Promise<PixelResult> => {
    const [x0, y0, x1, y1] = request.window ?? [0, 0, width, height];
    const w = x1 - x0;
    const h = y1 - y0;
    const planes = [0, 1, 2].map((channel) => {
      const plane = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          plane[y * w + x] = 60 + 140 * valueNoise(x0 + x + channel * 1000, y0 + y, 6);
      return plane;
    });
    return Promise.resolve({ absent: false, width: w, height: h, planes });
  };
  return {
    formatId: "generic-tiff",
    levels: [level],
    tileSize: { width: tile, height: tile },
    micronsPerPixel: null,
    photometric: "rgb",
    dtype: "uint8",
    channels: [],
    getTile: () => Promise.reject(new Error("not used")),
    getRaster,
    close: () => {},
  };
}

async function kinds(source: PixelSource, name: string): Promise<(ReaderFindingKind | null)[]> {
  const checks = await checkAgainstReference(source, reference(name));
  if (process.env.READER_CHECK_MEASURE === "1")
    console.log(
      name,
      checks.map((c) => [c.window.level, c.meanError, c.finding?.detail]),
    );
  return checks.map((check) => check.finding?.kind ?? null);
}

describe("reader check: the browser reader agrees with the server reader", () => {
  for (const entry of slides) {
    it(`finds nothing wrong with ${entry.name}`, skipUnless(entry), async () => {
      const source = await open(entry);
      const found = await kinds(source, entry.name);
      assert.ok(found.length >= 1);
      assert.deepEqual(
        found,
        found.map(() => null),
      );
      source.close();
    });
  }
});

describe("reader check: the POC's known failures are caught", () => {
  const cases: readonly [string, string, RasterRewrite, ReaderFindingKind][] = [
    ["YCbCr shown as RGB", "synthetic-jpeg.tiff", ycbcrShownAsRgb, "colour-space"],
    ["YCbCr shown as RGB in Aperio 33003", "JP2K-33003-1.svs", ycbcrShownAsRgb, "colour-space"],
    ["red and blue swapped", "synthetic-jpeg.tiff", redAndBlueSwapped, "channel-order"],
    ["red and blue swapped", "CMU-1-Small-Region.svs", redAndBlueSwapped, "channel-order"],
    ["tiles placed three pixels off", "synthetic-jpeg.tiff", displaced(3, -2), "offset"],
    [
      "tiles placed three pixels off on tissue",
      "CMU-1-Small-Region.svs",
      displaced(3, -2),
      "offset",
    ],
    ["the neighbouring tile read", "CMU-1-Small-Region.svs", displaced(240, 0), "mismatch"],
  ];
  for (const [label, name, rewrite, kind] of cases) {
    it(`${label} (${name}) is reported as ${kind}`, skipUnless(slide(name)), async () => {
      const source = await open(slide(name));
      const found = await kinds(broken(source, rewrite), name);
      assert.ok(found.length >= 1);
      for (const value of found) assert.equal(value, kind);
      source.close();
    });
  }
});

describe("reader check: a misread pyramid ladder is caught", () => {
  it("a 2x level labelled 4x leaves the 2x reference with no level (synthetic-zlib.ome.tiff)", async () => {
    const source = await open(slide("synthetic-zlib.ome.tiff"));
    const found = await kinds(relabelled(source, [1, 4, 16]), "synthetic-zlib.ome.tiff");
    assert.deepEqual(found, [null, "missing-level"]);
    source.close();
  });

  for (const name of ["CMU-1.svs", "JP2K-33003-1.svs"]) {
    it(`a coarser level labelled 4x is caught (${name})`, skipUnless(slide(name)), async () => {
      const source = await open(slide(name));
      const found = await kinds(relabelled(source, [1, 0.5, 4]), name);
      assert.deepEqual(found, [null, "unreadable"]);
      source.close();
    });
  }
});

describe("reader check: seams", () => {
  const textured = texturedSource(4096, 2048, 256);

  it("a correctly tiled textured slide scores like the POC's clean slides", async () => {
    const check = await checkSeams(textured);
    assert.equal(check.finding, null);
    for (const score of [check.vertical, check.horizontal]) {
      assert.ok(score.boundaries >= 4);
      assert.ok(score.ratio !== null && score.ratio < 1.4, `ratio ${score.ratio}`);
    }
  });

  it("overlapping camera frames drawn as a tile grid show as seams", async () => {
    const check = await checkSeams(broken(textured, overlappingFrames(40)));
    assert.equal(check.finding?.kind, "seam");
  });

  it(
    "a seamless tissue slide passes (CMU-1-Small-Region.svs)",
    skipUnless(slide("CMU-1-Small-Region.svs")),
    async () => {
      const source = await open(slide("CMU-1-Small-Region.svs"));
      const check = await checkSeams(source);
      if (process.env.READER_CHECK_MEASURE === "1") console.log(check);
      assert.equal(check.finding, null);
      assert.ok(check.vertical.boundaries >= 4 && check.horizontal.boundaries >= 4);
      source.close();
    },
  );

  it(
    "overlapping frames on tissue show as seams (CMU-1-Small-Region.svs)",
    skipUnless(slide("CMU-1-Small-Region.svs")),
    async () => {
      const source = await open(slide("CMU-1-Small-Region.svs"));
      const check = await checkSeams(broken(source, overlappingFrames(40)));
      if (process.env.READER_CHECK_MEASURE === "1") console.log(check);
      assert.equal(check.finding?.kind, "seam");
      source.close();
    },
  );
});
