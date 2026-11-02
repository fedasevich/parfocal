import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type LatencyProxy, startLatencyProxy } from "@parfocal/latency-proxy";
import { budget, exceeds } from "../../../../scripts/perf-budgets.ts";
import {
  openTiffSource,
  type PixelLevel,
  type PixelResult,
  readTileIndex,
  type SlideFormatId,
  type SlideIndex,
  TileIndexError,
  tileOffsets,
} from "../../src/pixel-source/index.ts";
import { syntheticDir } from "./fixtures.ts";
import { type Served, serve } from "./serve.ts";
import { writeSpreadBigTiff } from "./spread-bigtiff.ts";

const goldenDir = new URL("../../../../workers/ingest/tests/golden/tile-index/", import.meta.url);
const contract: ReadonlyArray<readonly [string, SlideFormatId]> = [
  ["synthetic-jpeg.tiff", "generic-tiff"],
  ["synthetic-sparse.tiff", "generic-tiff"],
  ["synthetic-zlib.ome.tiff", "ome-tiff"],
  ["synthetic-big-endian.tiff", "generic-tiff"],
  ["synthetic-channels-uint8.ome.tiff", "ome-tiff"],
];
const rttMs = 100;
const sidecarOpen = await budget("viewer.sidecar-open-ms");
const sidecarSamples = 3;
const browserConnections = 6;

async function sidecarOf(name: string): Promise<SlideIndex> {
  return readTileIndex(JSON.parse(await readFile(new URL(`${name}.json`, goldenDir), "utf8")));
}

function planes(result: PixelResult): number[][] {
  if (result.absent) return [];
  return result.planes.map((plane) => Array.from(plane));
}

function shape(level: PixelLevel): PixelLevel {
  const { downsample, width, height, tileWidth, tileHeight } = level;
  return { downsample, width, height, tileWidth, tileHeight };
}

const served = await serve({ "/synthetic": syntheticDir });
after(() => served.close());

describe("the sidecar written by the ingest worker", () => {
  for (const [name, formatId] of contract) {
    it(`opens ${name} to the same pixels with fewer requests`, async () => {
      const url = served.url(`/synthetic/${name}`);
      const index = await sidecarOf(name);
      assert.equal(index.formatId, formatId);
      const before = served.requests.length;
      const walked = await openTiffSource({ formatId, url, nativeJpeg: "off" });
      const walkedRequests = served.requests.length - before;
      const middle = served.requests.length;
      const indexed = await openTiffSource({ formatId, url, index, nativeJpeg: "off" });
      const indexedRequests = served.requests.length - middle;
      assert.ok(indexedRequests <= walkedRequests);
      assert.deepEqual(indexed.levels.map(shape), walked.levels.map(shape));
      assert.deepEqual(indexed.micronsPerPixel, walked.micronsPerPixel);
      assert.deepEqual(indexed.channels, walked.channels);
      assert.ok(planes(await walked.getTile({ level: 0, x: 0, y: 0 })).length > 0);
      for (const level of indexed.levels.keys()) {
        const request = { level, x: 0, y: 0 };
        assert.deepEqual(
          planes(await indexed.getTile(request)),
          planes(await walked.getTile(request)),
        );
      }
      walked.close();
      indexed.close();
    });
  }

  it("reports an absent tile from the sidecar without fetching it", async () => {
    const url = served.url("/synthetic/synthetic-sparse.tiff");
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url,
      index: await sidecarOf("synthetic-sparse.tiff"),
      nativeJpeg: "off",
    });
    const before = served.requests.length;
    const tile = await source.getTile({ level: 0, x: 1, y: 0 });
    assert.equal(tile.absent, true);
    assert.equal(served.requests.length, before);
    source.close();
  });
});

describe("reading a tile index", () => {
  it("rebuilds absolute offsets from gaps", () => {
    const offsets = tileOffsets({
      page: 0,
      tileOffsetGaps: [100, 0, -350, 400, -110],
      tileByteCounts: [50, 200, 0, 10, 20],
    });
    assert.deepEqual(offsets, [100, 150, 0, 400, 300]);
  });

  it("refuses a document it cannot trust", () => {
    const level = {
      page: 0,
      ifdOffset: 8,
      tileOffsetGaps: [8],
      tileByteCounts: [1],
      downsample: 1,
      width: 1,
      height: 1,
    };
    const good = { version: 1, formatId: "generic-tiff", levels: [level] };
    assert.equal(readTileIndex(good).formatId, "generic-tiff");
    for (const bad of [
      null,
      { ...good, version: 2 },
      { ...good, formatId: "png" },
      { ...good, levels: [] },
      { ...good, levels: [{ ...level, ifdOffset: undefined }] },
      { ...good, levels: [{ ...level, tileByteCounts: [1, 2] }] },
      { ...good, levels: [{ ...level, width: undefined }] },
      { ...good, levels: [{ ...level, siblings: [{ page: 1 }] }] },
    ]) {
      assert.throws(() => readTileIndex(bad), TileIndexError);
    }
  });
});

function limitConnections(limit: number): () => void {
  const original = globalThis.fetch;
  let active = 0;
  const waiting: Array<() => void> = [];
  globalThis.fetch = async (input, init) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      const response = await original(input, init);
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}

describe(`opening a spread BigTIFF at ${rttMs} ms RTT`, () => {
  let folder = "";
  let origin: Served | null = null;
  let proxy: LatencyProxy | null = null;
  let sidecar: unknown = null;
  let restore: () => void = () => {};

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "tile-index-"));
    const written = await writeSpreadBigTiff({
      path: join(folder, "spread.tiff"),
      levels: 11,
      baseSize: 65536,
      tileSize: 256,
    });
    sidecar = written.sidecar;
    await writeFile(join(folder, "tile-index.json"), JSON.stringify(sidecar));
    origin = await serve({ "/slide": folder });
    proxy = await startLatencyProxy({ target: origin.origin, rttMs });
    restore = limitConnections(browserConnections);
  });

  after(async () => {
    restore();
    await proxy?.close();
    await origin?.close();
    await rm(folder, { recursive: true, force: true });
  });

  async function timedOpen(withIndex: boolean): Promise<{ ms: number; levels: number }> {
    const base = proxy?.url ?? "";
    const started = performance.now();
    const index = withIndex
      ? readTileIndex(await (await fetch(`${base}/slide/tile-index.json`)).json())
      : undefined;
    const source = await openTiffSource({
      formatId: "generic-tiff",
      url: `${base}/slide/spread.tiff`,
      nativeJpeg: "off",
      ...(index === undefined ? {} : { index }),
    });
    const coarsest = source.levels.length - 1;
    await source.getTile({ level: coarsest, x: 0, y: 0 });
    const ms = performance.now() - started;
    const levels = source.levels.length;
    source.close();
    return { ms, levels };
  }

  it(`opens with the sidecar in under ${sidecarOpen.limit} ms where the walk takes longer`, async () => {
    const walked = await timedOpen(false);
    let indexed = await timedOpen(true);
    for (let sample = 1; sample < sidecarSamples; sample++) {
      const next = await timedOpen(true);
      if (next.ms < indexed.ms) indexed = next;
    }
    console.log(
      `spread BigTIFF, 11 IFDs, ${rttMs} ms RTT: walk ${Math.round(walked.ms)} ms, sidecar ${Math.round(indexed.ms)} ms, fastest of ${sidecarSamples}`,
    );
    assert.equal(indexed.levels, walked.levels);
    assert.equal(exceeds(sidecarOpen, indexed.ms), null);
    assert.ok(walked.ms > indexed.ms);
  });
});
