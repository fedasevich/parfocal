import { expect, test } from "@playwright/test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import type { TileReport } from "../j2k-bench/page/j2k-bench-harness.ts";
import type { SlideFormatId } from "../src/index.ts";
import { harnessUrl } from "./cdp.ts";

interface DecodeSlide {
  readonly file: string;
  readonly formatId: SlideFormatId;
  readonly tileSize: number;
  readonly block: readonly [number, number];
  readonly budget: string;
}

const slides: readonly DecodeSlide[] = [
  {
    file: "CMU-1.svs",
    formatId: "aperio-svs",
    tileSize: 256,
    block: [109, 38],
    budget: "viewer.decode-tile-p95-ms",
  },
  {
    file: "CMU-1-JP2K-33005.svs",
    formatId: "aperio-svs",
    tileSize: 240,
    block: [116, 41],
    budget: "viewer.jp2k.decode-tile-p95-ms",
  },
  {
    file: "CMU-1.tiff",
    formatId: "generic-tiff",
    tileSize: 256,
    block: [109, 38],
    budget: "viewer.tiff.decode-tile-p95-ms",
  },
];

const blockSide = 6;
const repeats = 3;

function blockTiles(block: readonly [number, number]): (readonly [number, number])[] {
  const tiles: (readonly [number, number])[] = [];
  for (let row = 0; row < blockSide; row++) {
    for (let column = 0; column < blockSide; column++) {
      tiles.push([block[0] + column, block[1] + row]);
    }
  }
  return tiles;
}

function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

for (const slide of slides) {
  test(`one decode worker reads a warm level 0 tile of ${slide.file} within the decode budget`, async ({
    page,
  }, testInfo) => {
    const availability = fixtureAvailability(slide.file);
    if (availability.status === "missing" && availability.required) {
      throw new Error(availability.message);
    }
    test.skip(
      availability.status === "missing",
      availability.status === "missing" ? availability.message : "",
    );
    await page.goto(harnessUrl("/app/decode-budget.html"));
    await page.waitForFunction(() => window.j2kBench !== undefined);
    const passes: number[] = [];
    for (let pass = 0; pass < 3; pass++) {
      const report: TileReport = await page.evaluate((request) => window.j2kBench.tiles(request), {
        url: harnessUrl(`/cache/${slide.file}`),
        formatId: slide.formatId,
        level: 0,
        tileSize: slide.tileSize,
        tiles: blockTiles(slide.block),
        repeats,
      });
      expect(report.error).toBeNull();
      expect(report.warmMs).toHaveLength(blockSide * blockSide * repeats);
      passes.push(p95(report.warmMs));
    }
    const fastest = Math.min(...passes);
    const description = `${slide.file} warm tile through one decode worker, p95 of ${blockSide * blockSide * repeats} reads, fastest of 3 passes: ${fastest.toFixed(1)} ms (passes ${passes.map((value) => value.toFixed(1)).join(", ")})`;
    testInfo.annotations.push({ type: "perf", description });
    console.log(description);
    await checkBudget(slide.budget, fastest, { rttMs: 0 });
  });
}
