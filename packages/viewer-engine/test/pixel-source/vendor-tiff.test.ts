import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  fixturesDir,
  referenceTilesDir,
  skipUnlessCached,
  syntheticDir,
} from "@parfocal/test-fixtures";
import { PNG } from "pngjs";
import {
  checkAgainstReference,
  createDefaultPixelSourceRegistry,
  type PixelSource,
  READER_AGREEMENT,
  type ReferenceWindow,
  rgbFromInterleaved,
  type SlideFormatId,
  tileColumns,
  tileRows,
} from "../../src/index.ts";
import { argosFocusedPlane } from "../../src/pixel-source/tiff/argos.ts";
import {
  micronsFromDescription,
  micronsFromPhilipsDescription,
} from "../../src/pixel-source/tiff/scale.ts";
import { pixelSourceConformance } from "./conformance.ts";
import { serve } from "./serve.ts";
import { type PlainPage, philipsDescription, plainTiledTiff } from "./vendor-tiff-fixture.ts";

const generated = mkdtempSync(join(tmpdir(), "parfocal-vendor-tiff-"));

function plainPage(
  width: number,
  height: number,
  downsample: number,
  plane: number,
  metadata?: string,
): PlainPage {
  return {
    ...(metadata === undefined ? {} : { metadata }),
    width,
    height,
    tile: 64,
    pixelsPerCentimetre: 25_000,
    sample: (x, y) => [(x * downsample) & 255, (y * downsample) & 255, 40 + plane * 100],
  };
}

writeFileSync(
  join(generated, "huron-like.tif"),
  plainTiledTiff([plainPage(600, 440, 1, 0), plainPage(150, 110, 4, 0), plainPage(38, 28, 16, 0)]),
);
function stacked(metadata?: string): Uint8Array {
  return plainTiledTiff([
    plainPage(300, 200, 1, 0, metadata),
    plainPage(150, 100, 2, 0),
    plainPage(300, 200, 1, 1),
    plainPage(150, 100, 2, 1),
    plainPage(300, 200, 1, 2),
    plainPage(150, 100, 2, 2),
    plainPage(64, 64, 1, 0),
  ]);
}

function argosMetadata(lowest: number, highest: number): string {
  return `<Argos.Scan.Metadata><ZRange>8</ZRange><MinZ>${lowest}</MinZ><MaxZ>${highest}</MaxZ></Argos.Scan.Metadata>`;
}

writeFileSync(join(generated, "argos-like-stacked.avs"), stacked(argosMetadata(-1, 1)));
writeFileSync(join(generated, "argos-like-upward.avs"), stacked(argosMetadata(0, 2)));
writeFileSync(join(generated, "argos-like-unlabelled.avs"), stacked());

const served = await serve({
  "/generated": generated,
  "/synthetic": syntheticDir,
  "/cache": fixturesDir(),
});

after(async () => {
  await served.close();
  rmSync(generated, { recursive: true, force: true });
});

const registry = createDefaultPixelSourceRegistry();

function open(formatId: SlideFormatId, path: string): Promise<PixelSource> {
  return registry.open({ formatId, url: served.url(path), nativeJpeg: "off" });
}

function shapes(source: PixelSource): number[][] {
  return source.levels.map((level) => [level.width, level.height, level.downsample]);
}

async function pixel(source: PixelSource, level: number, x: number, y: number): Promise<number[]> {
  const raster = await source.getRaster({ level, window: [x, y, x + 1, y + 1] });
  if (raster.absent) throw new Error("absent");
  return raster.planes.map((plane) => Number(plane[0]));
}

async function absentTiles(source: PixelSource, level: number): Promise<number> {
  const shape = source.levels[level];
  if (shape === undefined) throw new Error("no level");
  let absent = 0;
  for (let y = 0; y < tileRows(shape); y++) {
    for (let x = 0; x < tileColumns(shape); x++) {
      if ((await source.getTile({ level, x, y })).absent) absent++;
    }
  }
  return absent;
}

describe("Philips TIFF scale from the vendor XML", () => {
  const slide = { type: "WSI", spacing: "&quot;0.000226891&quot; &quot;0.000226907&quot;" };
  const macro = { type: "MACROIMAGE", spacing: "&quot;0.0315&quot; &quot;0.0315&quot;" };
  const label = { type: "LABELIMAGE", spacing: "&quot;0.0317&quot; &quot;0.0317&quot;" };

  it("reads row and column spacing in millimetres as y and x in microns", () => {
    const microns = micronsFromPhilipsDescription(philipsDescription([slide, macro, label]));
    assert.ok(microns !== null);
    assert.ok(Math.abs(microns.x - 0.226907) < 1e-9);
    assert.ok(Math.abs(microns.y - 0.226891) < 1e-9);
  });

  it("takes the spacing of the slide image when the macro and label come first", () => {
    const microns = micronsFromPhilipsDescription(philipsDescription([macro, label, slide]));
    assert.ok(microns !== null);
    assert.ok(Math.abs(microns.x - 0.226907) < 1e-9);
  });

  it("reads plain quotes and attributes whose name comes last, as Philips-4.tiff writes them", () => {
    const description = philipsDescription(
      [{ type: "WSI", spacing: '"0.00025" "0.00025"' }],
      "name-last",
    );
    assert.deepEqual(micronsFromDescription(description), { x: 0.25, y: 0.25 });
  });

  it("gives no scale without a slide image, without a spacing or for other XML", () => {
    assert.equal(micronsFromPhilipsDescription(philipsDescription([macro, label])), null);
    assert.equal(
      micronsFromPhilipsDescription(philipsDescription([{ type: "WSI", spacing: "" }])),
      null,
    );
    assert.equal(micronsFromPhilipsDescription('<OME><Pixels PhysicalSizeX="0.5"/></OME>'), null);
    assert.equal(
      micronsFromPhilipsDescription(
        philipsDescription([{ type: "WSI", spacing: "&quot;5&quot; &quot;5&quot;" }]),
      ),
      null,
    );
  });
});

describe("vendor format ids on generated files", () => {
  it("opens a sparse file as philips-tiff and reports the tiles left out", async () => {
    const source = await open("philips-tiff", "/synthetic/synthetic-sparse.tiff");
    assert.equal(source.formatId, "philips-tiff");
    assert.equal(await absentTiles(source, 0), 3);
    source.close();
  });

  it("reads an uncompressed huron-tiff with 1x, 4x and 16x levels exactly", async () => {
    const source = await open("huron-tiff", "/generated/huron-like.tif");
    assert.equal(source.formatId, "huron-tiff");
    assert.deepEqual(shapes(source), [
      [600, 440, 1],
      [150, 110, 4],
      [38, 28, 16],
    ]);
    assert.deepEqual(source.micronsPerPixel, { x: 0.4, y: 0.4 });
    assert.deepEqual(await pixel(source, 0, 599, 439), [599 & 255, 439 & 255, 40]);
    assert.deepEqual(await pixel(source, 1, 149, 109), [(149 * 4) & 255, (109 * 4) & 255, 40]);
    assert.deepEqual(await pixel(source, 2, 37, 27), [(37 * 16) & 255, (27 * 16) & 255, 40]);
    const last = await source.getTile({ level: 0, x: 9, y: 6 });
    assert.equal(last.width, 600 - 9 * 64);
    assert.equal(last.height, 440 - 6 * 64);
    source.close();
  });

  it("opens the plane at focus 0 of a stacked argos-avs, as the server reader does", async () => {
    const source = await open("argos-avs", "/generated/argos-like-stacked.avs");
    assert.equal(source.formatId, "argos-avs");
    assert.deepEqual(shapes(source), [
      [300, 200, 1],
      [150, 100, 2],
    ]);
    assert.deepEqual(await pixel(source, 0, 10, 20), [10, 20, 140]);
    assert.deepEqual(await pixel(source, 1, 10, 20), [20, 40, 140]);
    source.close();
  });

  it("opens the first plane when focus 0 is the first or the file does not say", async () => {
    for (const name of ["argos-like-upward.avs", "argos-like-unlabelled.avs"]) {
      const source = await open("argos-avs", `/generated/${name}`);
      assert.deepEqual(await pixel(source, 0, 10, 20), [10, 20, 40]);
      source.close();
    }
  });

  it("opens the first plane of the same file under another format id", async () => {
    const source = await open("generic-tiff", "/generated/argos-like-stacked.avs");
    assert.deepEqual(await pixel(source, 0, 10, 20), [10, 20, 40]);
    source.close();
  });

  it("reads the plane at focus 0 from the Argos metadata", () => {
    assert.equal(argosFocusedPlane(argosMetadata(-2, 2)), 2);
    assert.equal(argosFocusedPlane(argosMetadata(0, 0)), 0);
    assert.equal(argosFocusedPlane(argosMetadata(1, 3)), 0);
    assert.equal(argosFocusedPlane("<MinZ>-2</MinZ><MaxZ>2</MaxZ>"), 0);
  });
});

pixelSourceConformance(
  "geotiff, generated uncompressed Huron-like TIFF",
  () => open("huron-tiff", "/generated/huron-like.tif"),
  { levels: 3, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.4 },
);
pixelSourceConformance(
  "geotiff, generated stacked Argos-like TIFF",
  () => open("argos-avs", "/generated/argos-like-stacked.avs"),
  { levels: 2, photometric: "rgb", dtype: "uint8", micronsPerPixel: 0.4 },
);

const chromaUpsamplingAgreement = 6;
const lumaAgreement = 1;

interface RealSlide {
  readonly name: string;
  readonly formatId: SlideFormatId;
  readonly levels: readonly (readonly number[])[];
  readonly micronsPerPixel: { readonly x: number; readonly y: number };
  readonly leavesTilesOut: boolean;
  readonly lossless: boolean;
  readonly agreement: number;
  readonly conformanceHere: boolean;
}

const philipsLevels = (width: number, height: number, count: number) =>
  Array.from({ length: count }, (_, level) => [width >> level, height >> level, 2 ** level]);

const argosLevels = [
  [130546, 57440, 1],
  [65273, 28720, 2],
  [32636, 14360, 4],
  [16318, 7180, 8],
  [8159, 3590, 16],
  [4079, 1795, 32],
  [2039, 897, 64],
  [1019, 448, 128],
];
const argosScale = { x: 0.38300410109301325, y: 0.38300410109301325 };

const slides: readonly RealSlide[] = [
  {
    name: "Philips-4.tiff",
    formatId: "philips-tiff",
    levels: philipsLevels(91136, 68096, 9),
    micronsPerPixel: { x: 0.25, y: 0.25 },
    leavesTilesOut: true,
    lossless: false,
    agreement: READER_AGREEMENT,
    conformanceHere: false,
  },
  {
    name: "Philips-3.tiff",
    formatId: "philips-tiff",
    levels: philipsLevels(131072, 100352, 9),
    micronsPerPixel: { x: 0.226907, y: 0.226891 },
    leavesTilesOut: false,
    lossless: false,
    agreement: READER_AGREEMENT,
    conformanceHere: true,
  },
  {
    name: "Huron-1-40x.tif",
    formatId: "huron-tiff",
    levels: [
      [12040, 21006, 1],
      [3010, 5252, 4],
      [753, 1313, 16],
    ],
    micronsPerPixel: { x: 0.2, y: 0.2 },
    leavesTilesOut: false,
    lossless: false,
    agreement: chromaUpsamplingAgreement,
    conformanceHere: false,
  },
  {
    name: "Huron-1-Uncompressed.tif",
    formatId: "huron-tiff",
    levels: [
      [6022, 10503, 1],
      [1506, 2626, 4],
      [377, 657, 16],
    ],
    micronsPerPixel: { x: 0.4, y: 0.4 },
    leavesTilesOut: false,
    lossless: true,
    agreement: READER_AGREEMENT,
    conformanceHere: true,
  },
  {
    name: "Argos-1.avs",
    formatId: "argos-avs",
    levels: argosLevels,
    micronsPerPixel: argosScale,
    leavesTilesOut: true,
    lossless: false,
    agreement: READER_AGREEMENT,
    conformanceHere: false,
  },
  {
    name: "Argos-1-Stacked.avs",
    formatId: "argos-avs",
    levels: argosLevels,
    micronsPerPixel: argosScale,
    leavesTilesOut: true,
    lossless: false,
    agreement: READER_AGREEMENT,
    conformanceHere: true,
  },
];

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

const lumaWeights = [0.299, 0.587, 0.114];

async function lumaError(source: PixelSource, window: ReferenceWindow): Promise<number> {
  const level = source.levels.findIndex((entry) => entry.downsample === window.downsample);
  const raster = await source.getRaster({
    level,
    window: [window.x, window.y, window.x + window.width, window.y + window.height],
  });
  if (raster.absent) throw new Error("absent");
  let sum = 0;
  const size = window.width * window.height;
  for (let index = 0; index < size; index++) {
    let difference = 0;
    for (const [channel, weight] of lumaWeights.entries()) {
      const read = Number(raster.planes[channel]?.[index]);
      difference += weight * (read - (window.image.planes[channel]?.[index] ?? 0));
    }
    sum += Math.abs(difference);
  }
  return sum / size;
}

for (const slide of slides) {
  const skip = skipUnlessCached(slide.name);
  const path = `/cache/${slide.name}`;

  describe(`${slide.formatId} on ${slide.name}`, { skip }, () => {
    it("reads the level sizes and the scale OpenSlide reports", async () => {
      const source = await open(slide.formatId, path);
      assert.deepEqual(shapes(source), slide.levels);
      assert.ok(source.micronsPerPixel !== null);
      assert.ok(Math.abs(source.micronsPerPixel.x - slide.micronsPerPixel.x) < 1e-9);
      assert.ok(Math.abs(source.micronsPerPixel.y - slide.micronsPerPixel.y) < 1e-9);
      assert.equal(source.photometric, "rgb");
      source.close();
    });

    it("shows the pixels the server reader shows", async () => {
      const source = await open(slide.formatId, path);
      const checks = await checkAgainstReference(source, reference(slide.name));
      if (process.env.READER_CHECK_MEASURE === "1")
        console.log(
          slide.name,
          checks.map((check) => [check.window.level, check.window.downsample, check.meanError]),
        );
      assert.equal(checks.length, 2);
      const lumas = await Promise.all(checks.map((check) => lumaError(source, check.window)));
      if (process.env.READER_CHECK_MEASURE === "1") console.log(slide.name, "luma", lumas);
      const [fullResolution] = lumas;
      assert.ok(
        fullResolution !== undefined && fullResolution <= lumaAgreement,
        `luma is ${fullResolution} apart at full resolution`,
      );
      for (const check of checks) {
        assert.ok(
          check.meanError !== null && check.meanError <= slide.agreement,
          `level ${check.window.level} is ${check.meanError} from the server reader`,
        );
        if (slide.agreement === READER_AGREEMENT) assert.equal(check.finding, null);
        if (slide.lossless && check.window.downsample === 1) assert.equal(check.meanError, 0);
      }
      source.close();
    });

    it("reads a scanned tile and reports an unscanned one without asking for it", async () => {
      const source = await open(slide.formatId, path);
      const [window] = reference(slide.name);
      const level = source.levels[0];
      if (window === undefined || level === undefined) throw new Error("no reference window");
      const scanned = await source.getTile({
        level: 0,
        x: Math.floor(window.x / level.tileWidth),
        y: Math.floor(window.y / level.tileHeight),
      });
      assert.equal(scanned.absent, false);
      const from = served.log.length;
      const corner = await source.getTile({ level: 0, x: 0, y: 0 });
      assert.equal(corner.absent, slide.leavesTilesOut);
      if (slide.leavesTilesOut) assert.equal(served.log.length, from);
      source.close();
    });
  });

  if (!slide.conformanceHere) continue;
  if (skip === false) {
    pixelSourceConformance(`geotiff, ${slide.name}`, () => open(slide.formatId, path), {
      levels: slide.levels.length,
      photometric: "rgb",
      dtype: "uint8",
      micronsPerPixel: slide.micronsPerPixel,
    });
  } else {
    describe(`PixelSource conformance: geotiff, ${slide.name}`, () =>
      it("reads the slide", { skip }));
  }
}
