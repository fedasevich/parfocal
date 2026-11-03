import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { cachedFetch } from "../../src/decode/byte-relay.ts";
import { createRangeCache } from "../../src/decode/range-cache.ts";
import {
  createDefaultPixelSourceRegistry,
  OverviewLevelsMismatchError,
  type OverviewLevelsRef,
  type PixelLevel,
  type PixelSource,
  type RasterRequest,
  readTileIndex,
  type SlideIndex,
  TileIndexError,
  withOverviewLevels,
} from "../../src/pixel-source/index.ts";
import {
  createVivLevels,
  readVivRegion,
  type VivRegion,
  type VivTile,
  virtualLadder,
} from "../../src/viv/viv-levels.ts";
import { cachedFixture, cachedFixtureDir, syntheticDir } from "./fixtures.ts";
import { serve } from "./serve.ts";

const ingestDir = fileURLToPath(new URL("../../../../workers/ingest/", import.meta.url));
const goldenDir = new URL("../../../../workers/ingest/tests/golden/tile-index/", import.meta.url);
const affected = ["CMU-1.svs", "JP2K-33003-1.svs", "CMU-1-JP2K-33005.svs"] as const;
const fullLadder = "CMU-1.tiff";
const samples = 3;

function level(downsample: number, width: number, height: number): PixelLevel {
  return { downsample, width, height, tileWidth: 256, tileHeight: 256 };
}

function fakeSource(levels: readonly PixelLevel[], seen: RasterRequest[] = []): PixelSource {
  return {
    formatId: "generic-tiff",
    levels,
    tileSize: { width: 256, height: 256 },
    micronsPerPixel: null,
    photometric: "rgb",
    dtype: "uint8",
    channels: [0, 1, 2].map((at) => ({ name: `${at}`, color: null, window: null })),
    getTile: () => Promise.resolve({ absent: true, width: 256, height: 256 }),
    getRaster: (request) => {
      seen.push(request);
      return Promise.resolve({ absent: true, width: 1, height: 1 });
    },
    close: () => undefined,
  };
}

const vendor = [level(1, 46000, 32914), level(4, 11500, 8229), level(16, 2875, 2058)];
const derived = [level(1, 1438, 1029), level(2, 719, 515), level(4, 360, 258), level(8, 180, 129)];
const reference: OverviewLevelsRef = {
  path: "overview-levels.tiff",
  downsamples: [32, 64, 128, 256],
};

describe("derived overview levels next to a vendor pyramid", () => {
  it("fill every coarse ladder step so Viv reads them with no residual", () => {
    const before = virtualLadder(vendor, 256).map((step) => step.residual);
    assert.deepEqual(before, [1, 2, 1, 2, 1, 2, 4, 8, 16]);
    const composed = withOverviewLevels(fakeSource(vendor), fakeSource(derived), reference);
    assert.deepEqual(
      composed.levels.map((entry) => entry.downsample),
      [1, 4, 16, 32, 64, 128, 256],
    );
    const after = virtualLadder(composed.levels, 256).map((step) => step.residual);
    assert.deepEqual(after, [1, 2, 1, 2, 1, 1, 1, 1, 1]);
  });

  it("route a derived level's reads to the sidecar at its own index", async () => {
    const own: RasterRequest[] = [];
    const sidecar: RasterRequest[] = [];
    const composed = withOverviewLevels(
      fakeSource(vendor, own),
      fakeSource(derived, sidecar),
      reference,
    );
    await composed.getRaster({ level: 2, window: [0, 0, 10, 10] });
    await composed.getRaster({ level: 6, window: [0, 0, 10, 10] });
    assert.deepEqual(
      own.map((request) => request.level),
      [2],
    );
    assert.deepEqual(
      sidecar.map((request) => request.level),
      [3],
    );
  });

  it("refuse a sidecar whose sizes do not match the slide", () => {
    const wrong = [level(1, 1437, 1029), ...derived.slice(1)];
    assert.throws(
      () => withOverviewLevels(fakeSource(vendor), fakeSource(wrong), reference),
      OverviewLevelsMismatchError,
    );
    assert.throws(
      () =>
        withOverviewLevels(fakeSource(vendor), fakeSource(derived), {
          ...reference,
          downsamples: [16, 64, 128, 256],
        }),
      OverviewLevelsMismatchError,
    );
  });
});

describe("the overview levels reference in the tile index", () => {
  const golden = async () =>
    JSON.parse(await readFile(new URL("synthetic-jpeg.tiff.json", goldenDir), "utf8")) as Record<
      string,
      unknown
    >;

  it("is read when its downsamples rise by powers of two", async () => {
    const index = readTileIndex({ ...(await golden()), overviewLevels: reference });
    assert.deepEqual(index.overviewLevels, reference);
  });

  it("is refused without a path or with downsamples that do not rise", async () => {
    const document = await golden();
    for (const overviewLevels of [
      { downsamples: [32] },
      { path: "a.tiff", downsamples: [] },
      { path: "a.tiff", downsamples: [64, 32] },
      { path: "a.tiff", downsamples: [24] },
    ]) {
      assert.throws(() => readTileIndex({ ...document, overviewLevels }), TileIndexError);
    }
  });

  it("falls back to the slide alone when the sidecar cannot be read", async () => {
    const served = await serve({ "/synthetic": syntheticDir });
    try {
      const index = readTileIndex({
        ...(await golden()),
        overviewLevels: { path: "missing-overview-levels.tiff", downsamples: [8] },
      });
      const source = await createDefaultPixelSourceRegistry().open({
        formatId: "generic-tiff",
        url: served.url("/synthetic/synthetic-jpeg.tiff"),
        index,
        nativeJpeg: "off",
      });
      assert.equal(source.levels.length, 3);
      source.close();
    } finally {
      await served.close();
    }
  });
});

interface CoarseRead {
  readonly ms: number;
  readonly pixelsRead: number;
  readonly tile: VivTile;
}

function hasUv(): boolean {
  return spawnSync("uv", ["--version"]).status === 0;
}

function writeSidecar(slide: string, output: string): string {
  const written = spawnSync(
    "uv",
    ["run", "python", "-m", "parfocal_ingest.overview_levels", slide, output],
    { cwd: ingestDir, encoding: "utf8" },
  );
  assert.equal(written.status, 0, written.stderr);
  return written.stdout.trim();
}

function meanAbsoluteDifference(a: Uint8Array, b: Uint8Array): number {
  assert.equal(a.length, b.length);
  let total = 0;
  for (let at = 0; at < a.length; at++) total += Math.abs((a[at] ?? 0) - (b[at] ?? 0));
  return total / a.length;
}

describe("coarse-zoom tile reads on the slides whose vendor pyramid skips levels", () => {
  const ready = affected.every((name) => cachedFixture(name) !== null) && cachedFixture(fullLadder);
  let folder = "";
  const references = new Map<string, OverviewLevelsRef>();
  let served: Awaited<ReturnType<typeof serve>> | null = null;

  before(async () => {
    if (!ready || !hasUv()) return;
    folder = await mkdtemp(join(tmpdir(), "overview-levels-"));
    for (const name of affected) {
      const output = join(folder, `${name}.overview-levels.tiff`);
      const downsamples = writeSidecar(join(cachedFixtureDir(), name), output);
      references.set(name, {
        path: `../derived/${name}.overview-levels.tiff`,
        downsamples: downsamples.split(",").map(Number),
      });
    }
    served = await serve({ "/cache": cachedFixtureDir(), "/derived": folder });
  });

  after(async () => {
    await served?.close();
    if (folder !== "") await rm(folder, { recursive: true, force: true });
  });

  const coarseRead = async (
    name: string,
    overviewLevels?: OverviewLevelsRef,
    fetch?: typeof globalThis.fetch,
  ): Promise<CoarseRead> => {
    assert.ok(served);
    const url = served.url(`/cache/${name}`);
    const formatId = name.endsWith(".svs") ? "aperio-svs" : "generic-tiff";
    const index =
      overviewLevels === undefined ? undefined : ({ formatId, overviewLevels } as SlideIndex);
    const source = await createDefaultPixelSourceRegistry().open({
      formatId,
      url,
      nativeJpeg: "off",
      ...(index ? { index } : {}),
      ...(fetch ? { fetch } : {}),
    });
    let pixelsRead = 0;
    const read = (region: VivRegion, _centre: unknown, signal?: AbortSignal) => {
      const [x0, y0, x1, y1] = region.window;
      pixelsRead += (x1 - x0) * (y1 - y0);
      return readVivRegion(source, region, signal);
    };
    const viv = createVivLevels(source, { read });
    const coarsest = viv.levels.at(-1);
    assert.ok(coarsest);
    const started = performance.now();
    const tile = await coarsest.getTile({ x: 0, y: 0 });
    const ms = performance.now() - started;
    source.close();
    return { ms, pixelsRead, tile };
  };

  const median = async (name: string, overviewLevels?: OverviewLevelsRef): Promise<CoarseRead> => {
    const reads: CoarseRead[] = [];
    for (let sample = 0; sample < samples; sample++)
      reads.push(await coarseRead(name, overviewLevels));
    reads.sort((a, b) => a.ms - b.ms);
    const middle = reads[Math.floor(samples / 2)];
    assert.ok(middle);
    return middle;
  };

  it("read within twice the pixels of a full ladder and draw the same tile", async (t) => {
    if (!ready)
      return t.skip("the Aperio and CMU-1.tiff slides are not cached, run: pnpm fixtures formats");
    if (!hasUv())
      return t.skip("uv is not installed, so the ingest worker cannot write the sidecar");
    const ladder = await median(fullLadder);
    t.diagnostic(`${fullLadder} full ladder: ${ladder.ms.toFixed(1)} ms, ${ladder.pixelsRead} px`);
    for (const name of affected) {
      const vendorOnly = await median(name);
      const withSidecar = await median(name, references.get(name));
      t.diagnostic(
        `${name}: vendor ladder ${vendorOnly.ms.toFixed(1)} ms ${vendorOnly.pixelsRead} px, with sidecar ${withSidecar.ms.toFixed(1)} ms ${withSidecar.pixelsRead} px`,
      );
      assert.ok(
        withSidecar.pixelsRead <= 2 * ladder.pixelsRead,
        `${name} read ${withSidecar.pixelsRead} px against ${ladder.pixelsRead}`,
      );
      assert.ok(vendorOnly.pixelsRead > 2 * ladder.pixelsRead);
      assert.equal(withSidecar.tile.width, vendorOnly.tile.width);
      assert.equal(withSidecar.tile.height, vendorOnly.tile.height);
      assert.ok(meanAbsoluteDifference(withSidecar.tile.data, vendorOnly.tile.data) < 2);
      const shared = await coarseRead(name, references.get(name), cachedFetch(createRangeCache()));
      assert.deepEqual(shared.tile.data, withSidecar.tile.data);
    }
  });
});
