import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@parfocal/test-fixtures";
import { expect, type Page, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { type LatencyProxy, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import type { SlideFormatId } from "../src/index.ts";
import { type Served, serve } from "../test/pixel-source/serve.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import type { Drive, DriveReport, PanSlide } from "./page/pan-harness.ts";

const ownSlide = process.env.PREFETCH_SLIDE;
const slideFile = ownSlide === undefined ? "CMU-1.svs" : basename(ownSlide);
const slideDir = ownSlide === undefined ? fixturesDir() : dirname(ownSlide);
const slideFormat = (process.env.PREFETCH_FORMAT ?? "aperio-svs") as SlideFormatId;
const slideCentre =
  ownSlide === undefined
    ? cmu1TissueCentre
    : { x: Number(process.env.PREFETCH_X ?? 0), y: Number(process.env.PREFETCH_Y ?? 0) };
const slidePath = `/cache/${slideFile}`;
const rttMs = Number(process.env.PREFETCH_RTT_MS ?? 100);
const repeats = Number(process.env.PREFETCH_REPEATS ?? 3);
const magnification = 10;
const settleTimeoutMs = 90_000;
const straight: Drive = { pxPerSecond: 1500, ms: 2400, zigzagPx: 0, vertical: true };
const zigzag: Drive = { pxPerSecond: 100, ms: 2400, zigzagPx: 60, vertical: true };
const reportDir = fileURLToPath(new URL("../test-results/prefetch-reports", import.meta.url));

const availability =
  ownSlide === undefined
    ? fixtureAvailability(slideFile)
    : ({ status: "ready", path: ownSlide } as const);

test.describe.configure({ mode: "serial", timeout: 600_000 });

let served: Served | null = null;
let proxy: LatencyProxy | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  if (availability.status !== "ready") return;
  served = await serve({ "/app": outDir, "/cache": slideDir }, { headers: crossOriginIsolated });
  proxy = await startLatencyProxy({ target: served.origin, rttMs });
});

test.afterAll(async () => {
  await proxy?.close();
  await served?.close();
  proxy = null;
  served = null;
});

test.beforeEach(() => {
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
});

interface Run {
  readonly prefetch: boolean;
  readonly drive: Drive;
  readonly rttMs: number;
  readonly fetches: number;
  readonly report: DriveReport;
}

async function driveRun(page: Page, prefetch: boolean, plan: Drive): Promise<Run> {
  if (served === null || proxy === null) throw new Error("The slide server is not running");
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertSwiftShader(page);
  await page.goto(`${proxy.url}/app/pan.html`);
  await page.waitForFunction(() => window.panHarness !== undefined);
  const slide: PanSlide = {
    url: `${proxy.url}${slidePath}`,
    formatId: slideFormat,
    workers: 6,
    reader: "shared-bytes",
    prefetch,
    magnification,
    ...slideCentre,
  };
  await page.evaluate((next) => window.panHarness.open(next), slide);
  const start = served.log.length;
  const report = await page.evaluate(
    ({ drive, timeout }) => window.panHarness.drive(drive, timeout),
    { drive: plan, timeout: settleTimeoutMs },
  );
  await page.evaluate(() => window.panHarness.close());
  const fetches = served.log.slice(start).filter((entry) => entry.path === slidePath).length;
  return { prefetch, drive: plan, rttMs, fetches, report };
}

function save(name: string, runs: readonly Run[]): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${name}.json`), `${JSON.stringify(runs, null, 2)}\n`);
  for (const run of runs) {
    console.log(
      `${name}: prefetch ${run.prefetch ? "on " : "off"} frames ${run.report.frames} settle ${run.report.settleMs.toFixed(0)} ms fetches ${run.fetches} requested ${run.report.prefetch?.requested ?? 0} started ${run.report.prefetch?.started ?? 0} dropped ${run.report.prefetch?.dropped ?? 0} used ${run.report.prefetch?.used ?? 0}`,
    );
  }
}

test(`time to a sharp view after a straight pan at ${rttMs} ms RTT, with and without prediction`, async ({
  page,
}) => {
  const runs: Run[] = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    runs.push(await driveRun(page, false, straight));
    runs.push(await driveRun(page, true, straight));
  }
  save("straight", runs);
  for (const run of runs) expect(run.report.errors).toEqual([]);
  const withPrediction = runs.filter((run) => run.prefetch);
  for (const run of withPrediction) {
    expect(run.report.prefetch?.requested ?? 0).toBeGreaterThan(0);
    expect(run.report.prefetch?.used ?? 0).toBeGreaterThan(0);
  }
  for (const run of runs.filter((entry) => !entry.prefetch)) {
    expect(run.report.prefetch?.requested ?? 0).toBe(0);
  }
});

test("a zig-zag pan prefetches nothing in the browser", async ({ page }) => {
  const run = await driveRun(page, true, zigzag);
  save("zigzag", [run]);
  expect(run.report.errors).toEqual([]);
  expect(run.report.prefetch?.requested ?? 0).toBe(0);
});
