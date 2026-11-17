import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type LatencyProxy, startLatencyProxy } from "@parfocal/latency-proxy";
import { parseLevelTable, signedOpenRequest } from "../../src/access/signed-slide.ts";
import { TileAccess } from "../../src/access/tile-access.ts";
import { openTiffSource } from "../../src/pixel-source/index.ts";
import { type Served, serve } from "../pixel-source/serve.ts";
import { writeSpreadBigTiff } from "../pixel-source/spread-bigtiff.ts";

const rttMs = 100;
const samples = 3;
const bigTiffDirectoryBytes = (entries: number) => 8 + entries * 20 + 8;

interface SidecarLevel {
  readonly page: number;
  readonly ifdOffset: number;
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
}

function levelTable(levels: readonly SidecarLevel[], located: boolean): unknown {
  return {
    reader: "tifffile",
    levels: levels.map((level, index) => ({
      index,
      downsample: level.downsample,
      width: level.width,
      height: level.height,
      stored: { width: level.width, height: level.height },
      ...(located
        ? {
            page: level.page,
            subIfd: null,
            ifdOffset: level.ifdOffset,
            ifdBytes: bigTiffDirectoryBytes(8),
            siblings: [],
          }
        : {}),
    })),
    scale: { mpp_x: 0.25, mpp_y: 0.25 },
  };
}

describe("parseLevelTable with directory offsets", () => {
  const levels: SidecarLevel[] = [
    { page: 0, ifdOffset: 4096, downsample: 1, width: 512, height: 512 },
    { page: 1, ifdOffset: 9000, downsample: 2, width: 256, height: 256 },
  ];

  it("carries every level's page and offset into the slide index", () => {
    const table = parseLevelTable(levelTable(levels, true));
    assert.deepEqual(table.levels[1]?.directory, {
      page: 1,
      subIfd: null,
      ifdOffset: 9000,
      siblings: [],
    });
  });

  it("drops the offsets of every level when one level lacks them", () => {
    const document = levelTable(levels, true) as { levels: Record<string, unknown>[] };
    const [first, second] = document.levels;
    const partial = { levels: [first, { ...second, ifdOffset: undefined }] };
    const table = parseLevelTable(partial);
    assert.ok(table.levels.every((level) => level.directory === undefined));
  });

  it("drops the offsets when a sibling is malformed", () => {
    const document = levelTable(levels, true) as { levels: Record<string, unknown>[] };
    const [first, second] = document.levels;
    const broken = { levels: [first, { ...second, siblings: [{ page: -1, ifdOffset: 5 }] }] };
    assert.ok(parseLevelTable(broken).levels.every((level) => level.directory === undefined));
  });
});

describe(`a signed open of a spread BigTIFF at ${rttMs} ms RTT`, () => {
  let folder = "";
  let origin: Served | null = null;
  let proxy: LatencyProxy | null = null;

  before(async () => {
    folder = await mkdtemp(join(tmpdir(), "located-levels-"));
    const written = await writeSpreadBigTiff({
      path: join(folder, "spread.tiff"),
      levels: 11,
      baseSize: 65536,
      tileSize: 256,
    });
    const sidecar: unknown = written.sidecar;
    const { levels } = sidecar as { readonly levels: readonly SidecarLevel[] };
    for (const [name, located] of [
      ["walked", false],
      ["located", true],
    ] as const) {
      const directory = join(folder, name);
      await mkdir(directory);
      await writeFile(join(directory, "levels.json"), JSON.stringify(levelTable(levels, located)));
      await link(join(folder, "spread.tiff"), join(directory, "spread.tiff"));
    }
    origin = await serve({ "/tiles": folder });
    proxy = await startLatencyProxy({ target: origin.origin, rttMs });
  });

  after(async () => {
    await proxy?.close();
    await origin?.close();
    await rm(folder, { recursive: true, force: true });
  });

  async function timedOpen(
    name: string,
  ): Promise<{ ms: number; levels: number; requests: number; peak: number }> {
    const before = origin?.requests.length ?? 0;
    const base = proxy?.url ?? "";
    const access = new TileAccess(() => Promise.resolve({ token: "t", lifetimeSeconds: 600 }));
    let inFlight = 0;
    let peak = 0;
    let opening = true;
    const fetcher = async (input: string, init: RequestInit) => {
      inFlight += 1;
      if (opening) peak = Math.max(peak, inFlight);
      const at = performance.now() - started;
      try {
        return await fetch(input, init);
      } finally {
        inFlight -= 1;
        if (process.env["PARFOCAL_OPEN_WATERFALL"] === "on") {
          const range = new Headers(init.headers).get("Range") ?? "";
          const done = Math.round(performance.now() - started);
          console.log(`${name}\t${Math.round(at)}\t${done}\t${input.split("/").pop()}\t${range}`);
        }
      }
    };
    const started = performance.now();
    const request = await signedOpenRequest({
      access,
      basePath: `/tiles/${name}/`,
      original: "spread.tiff",
      baseUrl: base,
      formatId: "generic-tiff",
      fetcher,
    });
    const source = await openTiffSource({ ...request, nativeJpeg: "off" });
    opening = false;
    await source.getTile({ level: source.levels.length - 1, x: 0, y: 0 });
    const ms = performance.now() - started;
    const levels = source.levels.length;
    source.close();
    return { ms, levels, requests: (origin?.requests.length ?? 0) - before, peak };
  }

  it("reads the directories at once instead of walking the chain", async () => {
    let walked = await timedOpen("walked");
    let located = await timedOpen("located");
    for (let sample = 1; sample < samples; sample++) {
      const nextWalk = await timedOpen("walked");
      const nextLocated = await timedOpen("located");
      if (nextWalk.ms < walked.ms) walked = nextWalk;
      if (nextLocated.ms < located.ms) located = nextLocated;
    }
    console.log(
      `signed open, spread BigTIFF, 11 IFDs, ${rttMs} ms RTT: walk ${Math.round(walked.ms)} ms in ${walked.requests} requests, located levels.json ${Math.round(located.ms)} ms in ${located.requests} requests, fastest of ${samples}, peak reads in flight while opening ${walked.peak} and ${located.peak}`,
    );
    assert.equal(located.levels, walked.levels);
    assert.ok(located.peak >= located.levels);
    assert.ok(walked.peak < located.levels);
    assert.ok(located.ms < walked.ms);
  });
});
