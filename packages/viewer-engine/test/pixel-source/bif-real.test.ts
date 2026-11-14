import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fixturesDir, referenceTilesDir, skipUnlessCached } from "@parfocal/test-fixtures";
import { PNG } from "pngjs";
import {
  checkAgainstReference,
  createDefaultPixelSourceRegistry,
  type PixelResult,
  type PixelSource,
  type PixelWindow,
  type ReferenceWindow,
  rgbFromInterleaved,
  type SlideIndex,
} from "../../src/index.ts";
import { serve } from "./serve.ts";

const slideName = "OS-1.bif";
const openSlideSize = { width: 105_813, height: 93_951 };
const storedSize = { width: 118_784, height: 102_000 };
const joint = { column: 59, row: 50, offsetDown: 439, stripHeight: 256, slack: 12 };

const served = await serve({ "/cache": fixturesDir() });
after(() => served.close());

const registry = createDefaultPixelSourceRegistry();
const skip = { skip: skipUnlessCached(slideName) };
const measuring = process.env.READER_CHECK_MEASURE === "1";

function sidecar(): SlideIndex {
  return JSON.parse(
    readFileSync(join(referenceTilesDir, slideName, "tile-index.json"), "utf8"),
  ) as SlideIndex;
}

function open(withIndex = true): Promise<PixelSource> {
  return registry.open({
    formatId: "ventana-bif",
    url: served.url(`/cache/${slideName}`),
    nativeJpeg: "off",
    ...(withIndex ? { index: sidecar() } : {}),
  });
}

function reference(): ReferenceWindow[] {
  const dir = join(referenceTilesDir, slideName);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as {
    windows: (Omit<ReferenceWindow, "image"> & { file: string })[];
  };
  return manifest.windows.map(({ file, ...window }) => {
    const png = PNG.sync.read(readFileSync(join(dir, file)));
    return { ...window, image: rgbFromInterleaved(png.width, png.height, png.data, 4) };
  });
}

function differenceAt(
  result: PixelResult & { absent: false },
  middle: number,
  shift: number,
  drop: number,
): number {
  let total = 0;
  let count = 0;
  for (const plane of result.planes) {
    for (let y = joint.slack; y < result.height - joint.slack; y++) {
      for (let x = 0; x < shift; x++) {
        const before = Number(plane[y * result.width + middle - shift + x]);
        const after = Number(plane[(y + drop) * result.width + middle + x]);
        total += Math.abs(before - after);
        count++;
      }
    }
  }
  return total / count;
}

async function closestRepeat(
  source: PixelSource,
  jointX: number,
  top: number,
  overlap: number,
): Promise<number> {
  const reach = overlap + joint.slack;
  const window: PixelWindow = [jointX - reach, top, jointX + reach, top + joint.stripHeight];
  const result = await source.getRaster({ level: 0, window });
  assert.equal(result.absent, false);
  if (result.absent) return Number.NaN;
  let closest = Number.POSITIVE_INFINITY;
  for (let shift = overlap - joint.slack; shift <= reach; shift++) {
    for (let drop = -joint.slack; drop <= joint.slack; drop++) {
      closest = Math.min(closest, differenceAt(result, reach, shift, drop));
    }
  }
  return closest;
}

describe("Ventana BIF on a real slide (OS-1.bif)", () => {
  it("opens through the default registry at the size OpenSlide reports", skip, async () => {
    const source = await open();
    assert.equal(source.formatId, "ventana-bif");
    assert.equal(source.levels[0]?.width, openSlideSize.width);
    assert.equal(source.levels[0]?.height, openSlideSize.height);
    assert.equal(source.photometric, "rgb");
    source.close();
  });

  it("agrees with OpenSlide within 2 grey levels through the registry", skip, async () => {
    const source = await open();
    const checks = await checkAgainstReference(source, reference());
    assert.equal(checks.length, 2);
    for (const check of checks)
      assert.ok(check.meanError !== null && check.meanError <= 2, `error ${check.meanError}`);
    source.close();
  });

  it("does not show the overlap strip twice at a frame joint in tissue", skip, async () => {
    const stitching = sidecar().stitching;
    assert.ok(stitching?.advanceX !== undefined && stitching.advanceY !== undefined);
    const overlap = Math.floor(stitching.frameWidth - stitching.advanceX);
    const stitched = await open();
    const stitchedRepeat = await closestRepeat(
      stitched,
      Math.ceil(joint.column * stitching.advanceX),
      Math.ceil(joint.row * stitching.advanceY) + joint.offsetDown,
      overlap,
    );
    stitched.close();
    const grid = await open(false);
    assert.equal(grid.levels[0]?.width, storedSize.width);
    const gridRepeat = await closestRepeat(
      grid,
      joint.column * stitching.frameWidth,
      joint.row * stitching.frameHeight + joint.offsetDown,
      overlap,
    );
    grid.close();
    if (measuring) console.log({ overlap, stitchedRepeat, gridRepeat });
    assert.ok(gridRepeat < 20, `the plain grid's closest repeat differs by ${gridRepeat}`);
    assert.ok(
      stitchedRepeat > 2.5 * gridRepeat,
      `stitched ${stitchedRepeat} against the plain grid's ${gridRepeat}`,
    );
  });
});
