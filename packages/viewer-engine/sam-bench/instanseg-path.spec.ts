import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  benchOriginVariable,
  instansegDir,
  instansegGraph,
  instansegPostProcess,
  instansegTilesDir,
} from "./global-setup.ts";
import type { TimingReport } from "./page/instanseg-path-harness.ts";

const appThreads = 0;
const tileBudgetMs = 1000;
const parityAgreement = 0.999;
const parityInstanceSlack = 0.01;
const reportDir = fileURLToPath(new URL("../test-results/sam-bench", import.meta.url));

interface TileEntry {
  name: string;
  file: string;
  labels: string;
  height: number;
  width: number;
  modelHeight: number;
  modelWidth: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

function origin(): string {
  const value = process.env[benchOriginVariable];
  if (!value) throw new Error("Run the bench through playwright test -c playwright.sam.config.ts");
  return value;
}

function skipWithoutExport() {
  const missing =
    !existsSync(join(instansegDir(), instansegGraph)) ||
    !existsSync(join(instansegDir(), instansegPostProcess));
  if (missing && process.env["PARFOCAL_REQUIRE_INSTANSEG"]) {
    throw new Error(`the InstanSeg export is missing from ${instansegDir()}`);
  }
  test.skip(missing, "run pnpm --filter @parfocal/ml export:instanseg first");
}

async function openPath(page: Page, threads: number) {
  await page.goto(`${origin()}/app/instanseg-path.html`);
  await page.waitForFunction(() => window.instansegPath !== undefined);
  return page.evaluate((setup) => window.instansegPath.setUp(setup), {
    graphUrl: `${origin()}/instanseg/${instansegGraph}`,
    postUrl: `${origin()}/instanseg/${instansegPostProcess}`,
    threads,
  });
}

test("the exported path reproduces the shipped test output", async ({ page }) => {
  skipWithoutExport();
  await openPath(page, appThreads);
  const report = await page.evaluate((request) => window.instansegPath.parity(request), {
    inputUrl: `${origin()}/instanseg/test-input.npy`,
    outputUrl: `${origin()}/instanseg/test-output_instance_segmentation.npy`,
  });
  console.log(JSON.stringify(report));
  expect(report.agreeing / report.pixels).toBeGreaterThanOrEqual(parityAgreement);
  expect(Math.abs(report.gotInstances - report.expectedInstances)).toBeLessThanOrEqual(
    Math.ceil(report.expectedInstances * parityInstanceSlack),
  );
});

const timings = new Map<number, TimingReport>();

for (const threads of [1, appThreads]) {
  test(`the whole path segments a 512 px tile on WebAssembly with ${threads === appThreads ? "the app's" : threads} threads`, async ({
    page,
  }) => {
    skipWithoutExport();
    await openPath(page, threads);
    const report = await page.evaluate((request) => window.instansegPath.time(request), {
      inputUrl: `${origin()}/instanseg/test-input.npy`,
      runs: 6,
    });
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      `${reportDir}/instanseg-path-${threads}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const steady = report.runs.slice(1);
    console.log(
      JSON.stringify({
        threads: report.threads,
        hardwareConcurrency: report.hardwareConcurrency,
        crossOriginIsolated: report.crossOriginIsolated,
        createMs: Math.round(report.createMs),
        tileSide: report.tileSide,
        seeds: report.runs[0]?.seeds,
        firstMs: Math.round(report.runs[0]?.totalMs ?? Number.NaN),
        steadyPrepareMs: Math.round(median(steady.map((run) => run.prepareMs))),
        steadyNetworkMs: Math.round(median(steady.map((run) => run.networkMs))),
        steadyLabelMs: Math.round(median(steady.map((run) => run.labelMs))),
        steadyTotalMs: Math.round(median(steady.map((run) => run.totalMs))),
      }),
    );
    expect(report.crossOriginIsolated).toBe(true);
    expect(report.tileSide).toBe(512);
    expect(report.runs[0]?.seeds ?? 0).toBeGreaterThan(0);
    timings.set(threads, report);
  });
}

test("the whole path, network and post-processing, runs a tile within the budget at the app's thread count", () => {
  const report = timings.get(appThreads);
  test.skip(report === undefined, "the app's thread count did not run");
  expect(median(report?.runs.slice(1).map((run) => run.totalMs) ?? [])).toBeLessThan(tileBudgetMs);
});

test("the exported path segments every dumped TNBC tile", async ({ page }) => {
  skipWithoutExport();
  const folder = instansegTilesDir();
  const manifestFile = join(folder, "manifest.json");
  test.skip(
    !existsSync(manifestFile),
    "run pnpm --filter @parfocal/ml bench:instanseg -- --dump-tiles DIR first",
  );
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
    micronsPerPixel: number;
    tiles: TileEntry[];
  };
  await openPath(page, appThreads);
  const totals: number[] = [];
  for (const tile of manifest.tiles) {
    const report = await page.evaluate((request) => window.instansegPath.segment(request), {
      url: `${origin()}/instanseg-tiles/${tile.file}`,
      width: tile.width,
      height: tile.height,
      micronsPerPixel: manifest.micronsPerPixel,
    });
    expect([report.height, report.width]).toEqual([tile.modelHeight, tile.modelWidth]);
    writeFileSync(join(folder, tile.labels), new Int32Array(report.labels));
    totals.push(report.totalMs);
  }
  console.log(JSON.stringify({ tiles: totals.length, medianTotalMs: Math.round(median(totals)) }));
});
