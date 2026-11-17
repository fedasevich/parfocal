import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { type LatencyProxy, startLatencyProxy } from "@parfocal/latency-proxy";
import {
  parseLevelTable,
  signedOpenRequest,
  slideIndexFromLevelTable,
} from "../../src/access/signed-slide.ts";
import { TileAccess } from "../../src/access/tile-access.ts";
import { openTiffSource } from "../../src/pixel-source/index.ts";
import type { SlideFormatId } from "../../src/pixel-source/types.ts";
import { type Served, serve } from "../pixel-source/serve.ts";
import { writeSpreadBigTiff } from "../pixel-source/spread-bigtiff.ts";
import {
  type PlainPage,
  philipsDescription,
  plainTiledTiff,
} from "../pixel-source/vendor-tiff-fixture.ts";
import { type WalkedDirectory, type WalkedTiff, walkTiffDirectories } from "./tiff-directories.ts";

const rttMs = 100;
const samples = 3;
const bigTiffDirectoryBytes = (entries: number) => 8 + entries * 20 + 8;

type Variant = "walked" | "located" | "primed";

interface TableLevel {
  readonly downsample: number;
  readonly width: number;
  readonly height: number;
}

function levelTable(
  levels: readonly TableLevel[],
  variant: Variant,
  tiff: WalkedTiff | null,
): unknown {
  const directories = tiff?.directories ?? [];
  return {
    reader: "tifffile",
    ...(variant === "primed" && tiff !== null
      ? { littleEndian: tiff.littleEndian, bigTiff: tiff.bigTiff }
      : {}),
    levels: levels.map((level, index) => {
      const directory = directories[index];
      const located =
        variant === "walked" || directory === undefined
          ? {}
          : {
              page: directory.page,
              subIfd: null,
              ifdOffset: directory.ifdOffset,
              siblings: [],
              ...(variant === "primed"
                ? { ifdBytes: directory.ifdBytes, valueRanges: directory.valueRanges }
                : {}),
            };
      return {
        index,
        downsample: level.downsample,
        width: level.width,
        height: level.height,
        stored: { width: level.width, height: level.height },
        ...located,
      };
    }),
    scale: { mpp_x: 0.25, mpp_y: 0.25 },
  };
}

describe("parseLevelTable with directory offsets", () => {
  const directories: WalkedDirectory[] = [
    { page: 0, ifdOffset: 4096, ifdBytes: 176, valueRanges: [[324, 5000, 64]], description: null },
    { page: 1, ifdOffset: 9000, ifdBytes: 176, valueRanges: [], description: null },
  ];
  const tiff: WalkedTiff = { littleEndian: true, bigTiff: true, directories };
  const levels: TableLevel[] = [
    { downsample: 1, width: 512, height: 512 },
    { downsample: 2, width: 256, height: 256 },
  ];

  it("carries every level's page and offset into the slide index", () => {
    const table = parseLevelTable(levelTable(levels, "located", tiff));
    assert.deepEqual(table.levels[1]?.directory, {
      page: 1,
      subIfd: null,
      ifdOffset: 9000,
      siblings: [],
    });
    assert.equal(table.header, null);
  });

  it("carries the header facts, directory sizes and value ranges into the slide index", () => {
    const table = parseLevelTable(levelTable(levels, "primed", tiff));
    assert.deepEqual(table.header, { littleEndian: true, bigTiff: true });
    const index = slideIndexFromLevelTable(table, "generic-tiff");
    assert.equal(index.bigTiff, true);
    assert.equal(index.levels?.[0]?.ifdBytes, bigTiffDirectoryBytes(8));
    assert.deepEqual(index.levels?.[0]?.valueRanges, [[324, 5000, 64]]);
  });

  it("keeps the offsets but drops the value ranges when they are malformed", () => {
    const document = levelTable(levels, "primed", tiff) as { levels: Record<string, unknown>[] };
    const [first, second] = document.levels;
    const broken = { levels: [{ ...first, valueRanges: [[324, -1, 8]] }, second] };
    const table = parseLevelTable(broken);
    assert.equal(table.levels[0]?.directory?.ifdOffset, 4096);
    assert.equal(table.levels[0]?.directory?.valueRanges, undefined);
  });

  it("drops the offsets of every level when one level lacks them", () => {
    const document = levelTable(levels, "located", tiff) as { levels: Record<string, unknown>[] };
    const [first, second] = document.levels;
    const partial = { levels: [first, { ...second, ifdOffset: undefined }] };
    const table = parseLevelTable(partial);
    assert.ok(table.levels.every((level) => level.directory === undefined));
  });

  it("drops the offsets when a sibling is malformed", () => {
    const document = levelTable(levels, "located", tiff) as { levels: Record<string, unknown>[] };
    const [first, second] = document.levels;
    const broken = { levels: [first, { ...second, siblings: [{ page: -1, ifdOffset: 5 }] }] };
    assert.ok(parseLevelTable(broken).levels.every((level) => level.directory === undefined));
  });
});

interface Request {
  readonly file: string;
  readonly range: string;
  readonly start: number;
  readonly end: number;
}

interface TimedOpen {
  readonly ms: number;
  readonly levels: number;
  readonly requests: readonly Request[];
  readonly peak: number;
  readonly rounds: number;
}

function roundsAfterLevelTable(requests: readonly Request[]): number {
  const reads = requests.filter((request) => request.file !== "levels.json");
  const depth = new Map<Request, number>();
  for (const read of [...reads].sort((a, b) => a.start - b.start)) {
    const before = reads.filter((other) => other.end <= read.start);
    depth.set(read, 1 + Math.max(0, ...before.map((other) => depth.get(other) ?? 0)));
  }
  return Math.max(0, ...depth.values());
}

const parserSliceBytes = 4048;

function overlap(range: string, [offset, length]: readonly [number, number]): number {
  const match = /bytes=(\d+)-(\d+)/.exec(range);
  if (match === null) return 0;
  const end = Math.min(Number(match[2]) + 1, offset + length);
  return Math.max(0, end - Math.max(Number(match[1]), offset));
}

interface Fixture {
  readonly title: string;
  readonly formatId: SlideFormatId;
  readonly file: string;
  readonly write: (path: string) => Promise<readonly TableLevel[]>;
}

const spreadFixture: Fixture = {
  title: "a spread BigTIFF with 11 directories",
  formatId: "generic-tiff",
  file: "spread.tiff",
  write: async (path) => {
    const written = await writeSpreadBigTiff({ path, levels: 11, baseSize: 65536, tileSize: 256 });
    return (written.sidecar as { readonly levels: readonly TableLevel[] }).levels;
  },
};

function philipsPage(size: number, description?: string): PlainPage {
  return {
    ...(description === undefined ? {} : { description }),
    width: size,
    height: size,
    tile: 64,
    pixelsPerCentimetre: 40_000,
    sample: (x, y) => [x & 255, y & 255, 128],
  };
}

const philipsFixture: Fixture = {
  title: "a Philips TIFF with a large XML description",
  formatId: "philips-tiff",
  file: "philips.tiff",
  write: async (path) => {
    const slide = { type: "WSI", spacing: "&quot;0.00025&quot; &quot;0.00025&quot;" };
    const xml = philipsDescription(new Array(400).fill(slide));
    const sizes = [1024, 512, 256, 128];
    await writeFile(
      path,
      plainTiledTiff(sizes.map((size, at) => philipsPage(size, at === 0 ? xml : undefined))),
    );
    return sizes.map((size) => ({ downsample: 1024 / size, width: size, height: size }));
  },
};

for (const fixture of [spreadFixture, philipsFixture]) {
  describe(`a signed open of ${fixture.title} at ${rttMs} ms RTT`, () => {
    let folder = "";
    let origin: Served | null = null;
    let proxy: LatencyProxy | null = null;
    let tiff: WalkedTiff | null = null;

    before(async () => {
      folder = await mkdtemp(join(tmpdir(), "located-levels-"));
      const levels = await fixture.write(join(folder, fixture.file));
      tiff = await walkTiffDirectories(join(folder, fixture.file));
      for (const variant of ["walked", "located", "primed"] as const) {
        const directory = join(folder, variant);
        await mkdir(directory);
        const table = levelTable(levels, variant, tiff);
        await writeFile(join(directory, "levels.json"), JSON.stringify(table));
        await link(join(folder, fixture.file), join(directory, fixture.file));
      }
      origin = await serve({ "/tiles": folder });
      proxy = await startLatencyProxy({ target: origin.origin, rttMs });
    });

    after(async () => {
      await proxy?.close();
      await origin?.close();
      await rm(folder, { recursive: true, force: true });
    });

    async function timedOpen(variant: Variant): Promise<TimedOpen> {
      const base = proxy?.url ?? "";
      const access = new TileAccess(() => Promise.resolve({ token: "t", lifetimeSeconds: 600 }));
      const requests: Request[] = [];
      let inFlight = 0;
      let peak = 0;
      let opening = true;
      const started = performance.now();
      const fetcher = async (input: string, init: RequestInit) => {
        inFlight += 1;
        if (opening) peak = Math.max(peak, inFlight);
        const start = performance.now() - started;
        try {
          return await fetch(input, init);
        } finally {
          inFlight -= 1;
          const range = new Headers(init.headers).get("Range") ?? "";
          const file = input.split("/").pop() ?? "";
          const end = performance.now() - started;
          requests.push({ file, range, start, end });
          if (process.env["PARFOCAL_OPEN_WATERFALL"] === "on") {
            console.log(`${variant}\t${Math.round(start)}\t${Math.round(end)}\t${file}\t${range}`);
          }
        }
      };
      const request = await signedOpenRequest({
        access,
        basePath: `/tiles/${variant}/`,
        original: fixture.file,
        baseUrl: base,
        formatId: fixture.formatId,
        fetcher,
      });
      const source = await openTiffSource({ ...request, nativeJpeg: "off" });
      opening = false;
      await source.getTile({ level: source.levels.length - 1, x: 0, y: 0 });
      const ms = performance.now() - started;
      const levels = source.levels.length;
      source.close();
      return { ms, levels, requests, peak, rounds: roundsAfterLevelTable(requests) };
    }

    async function fastest(variant: Variant): Promise<TimedOpen> {
      let best = await timedOpen(variant);
      for (let sample = 1; sample < samples; sample++) {
        const next = await timedOpen(variant);
        if (next.ms < best.ms) best = next;
      }
      return best;
    }

    it("reads the directories, tile tables and first tile in at most three rounds", async () => {
      const walked = await fastest("walked");
      const located = await fastest("located");
      const primed = await fastest("primed");
      console.log(
        `signed open, ${fixture.title}, ${rttMs} ms RTT, fastest of ${samples}: walk ${Math.round(walked.ms)} ms in ${walked.rounds} rounds and ${walked.requests.length} requests, offsets only ${Math.round(located.ms)} ms in ${located.rounds} rounds and ${located.requests.length} requests, primed ${Math.round(primed.ms)} ms in ${primed.rounds} rounds and ${primed.requests.length} requests`,
      );
      assert.equal(located.levels, walked.levels);
      assert.equal(primed.levels, walked.levels);
      assert.ok(located.peak >= located.levels);
      assert.ok(walked.peak < located.levels);
      assert.ok(primed.rounds <= 3, `the primed open took ${primed.rounds} rounds`);
      assert.ok(primed.rounds < located.rounds);
      assert.ok(located.rounds < walked.rounds || located.ms < walked.ms);
      const ranges = primed.requests.map((request) => request.range).filter(Boolean);
      assert.equal(new Set(ranges).size, ranges.length, "a range was read twice");
      const description = tiff?.directories[0]?.description;
      if (description !== null && description !== undefined) {
        assert.ok(description[1] > 10 * parserSliceBytes);
        assert.ok(ranges.every((range) => overlap(range, description) <= parserSliceBytes));
      }
    });
  });
}
