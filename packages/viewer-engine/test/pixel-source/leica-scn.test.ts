import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fixturesDir, skipUnlessCached, syntheticDir } from "@parfocal/test-fixtures";
import { MultiRegionScnError, openTiffSource } from "../../src/index.ts";
import { largestPyramid, listPages, openTiff } from "../../src/pixel-source/tiff/directory.ts";
import { scnMainPyramid } from "../../src/pixel-source/tiff/leica-scn.ts";
import { serve } from "./serve.ts";

const served = await serve({ "/synthetic": syntheticDir, "/cache": fixturesDir() });

after(async () => {
  await served.close();
});

const decoyUrl = served.url("/synthetic/synthetic-decoy.scn");

const header = (images: string) =>
  `<?xml version="1.0"?><scn xmlns="http://www.leica-microsystems.com/scn/2010/10/01"><collection sizeX="1000" sizeY="3000">${images}</collection></scn>`;

const image = (view: string, dimensions: string) =>
  `<image><pixels>${dimensions}</pixels><view ${view} /></image>`;

const macro = image(
  'sizeX="1000" sizeY="3000"',
  '<dimension sizeX="10" sizeY="30" r="0" ifd="0" />',
);

describe("Leica SCN main pyramid", () => {
  it("has a macro decoy that the largest-pyramid rule would pick", async () => {
    const tiff = await openTiff(new URL(decoyUrl));
    const pyramid = largestPyramid(await listPages(tiff));
    assert.deepEqual(
      pyramid.map((page) => `${page.image.getWidth()}x${page.image.getHeight()}`),
      ["1536x2048", "384x512"],
    );
  });

  it("opens the main image the SCN header names, not the macro", async () => {
    const source = await openTiffSource({ formatId: "leica-scn", url: decoyUrl });
    assert.deepEqual(
      source.levels.map((level) => `${level.downsample} ${level.width}x${level.height}`),
      ["1 1024x768", "2 512x384", "4 256x192"],
    );
    assert.deepEqual(source.micronsPerPixel, { x: 0.5, y: 0.5 });
    const block = await source.getRaster({ level: 0, window: [900, 650, 960, 700] });
    assert.ok(!block.absent);
    const [red, green, blue] = block.planes;
    assert.ok(red !== undefined && green !== undefined && blue !== undefined);
    const mean = (plane: ArrayLike<number>) =>
      Array.from(plane).reduce((sum, value) => sum + value, 0) / plane.length;
    assert.ok(Math.abs(mean(red) - 200) < 8, `red ${mean(red)}`);
    assert.ok(Math.abs(mean(green) - 40) < 8, `green ${mean(green)}`);
    assert.ok(Math.abs(mean(blue) - 90) < 8, `blue ${mean(blue)}`);
    source.close();
  });

  it("lists the main image's levels by resolution and skips other channels and planes", () => {
    const main = image(
      'sizeX="400" sizeY="300" offsetX="10" offsetY="20"',
      [
        '<dimension sizeX="4" sizeY="3" r="2" ifd="5" />',
        '<dimension sizeX="40" sizeY="30" r="0" ifd="3" />',
        '<dimension sizeX="40" sizeY="30" r="0" c="1" ifd="6" />',
        '<dimension sizeX="40" sizeY="30" r="0" z="1" ifd="7" />',
        '<dimension sizeX="10" sizeY="8" r="1" ifd="4" />',
      ].join(""),
    );
    assert.deepEqual(scnMainPyramid(header(macro + main)), [3, 4, 5]);
  });

  it("leaves files that are not Leica SCN to the largest-pyramid rule", () => {
    assert.equal(scnMainPyramid("Aperio Image Library v12"), null);
    assert.equal(scnMainPyramid(header(macro)), null);
  });

  it("refuses a header with more than one main image", () => {
    const region = (ifd: number) =>
      image('sizeX="400" sizeY="300"', `<dimension sizeX="40" sizeY="30" r="0" ifd="${ifd}" />`);
    assert.throws(
      () => scnMainPyramid(header(macro + region(1) + region(2))),
      (error: unknown) => error instanceof MultiRegionScnError && error.regions === 2,
    );
  });

  it("refuses the multi-region Leica-3.scn as the ingest worker does", {
    skip: skipUnlessCached("Leica-3.scn"),
  }, async () => {
    await assert.rejects(
      openTiffSource({ formatId: "leica-scn", url: served.url("/cache/Leica-3.scn") }),
      MultiRegionScnError,
    );
  });
});
