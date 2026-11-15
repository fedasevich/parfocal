import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { budget } from "../../../scripts/perf-budgets.ts";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import type { PanSlide } from "../browser/page/pan-harness.ts";
import type { GpuInfo } from "../j2k-bench/page/j2k-bench-harness.ts";
import type { SlideFormatId } from "../src/index.ts";
import type { Served } from "../test/pixel-source/serve.ts";
import { buildAndServe, pagePath } from "./global-setup.ts";
import type { GpuFrames } from "./page/frame-bench-harness.ts";

interface FrameSlide {
  readonly file: string;
  readonly formatId: SlideFormatId;
  readonly panBudget: string;
  readonly gpuBudget: string;
}

const slides: readonly FrameSlide[] = [
  {
    file: "CMU-1.svs",
    formatId: "aperio-svs",
    panBudget: "viewer.pan-frame-p95-ms",
    gpuBudget: "viewer.raster-gpu-ms",
  },
  {
    file: "CMU-1-JP2K-33005.svs",
    formatId: "aperio-svs",
    panBudget: "viewer.jp2k.pan-frame-p95-ms",
    gpuBudget: "viewer.jp2k.raster-gpu-ms",
  },
  {
    file: "CMU-1.tiff",
    formatId: "generic-tiff",
    panBudget: "viewer.tiff.pan-frame-p95-ms",
    gpuBudget: "viewer.tiff.raster-gpu-ms",
  },
];

const smoke = process.env["FRAME_BENCH_SMOKE"] === "1";
const repetitions = smoke ? 1 : 3;
const magnification = 10;
const panPxPerSecond = 1000;
const panMs = smoke ? 500 : 3000;
const gpuWarmup = smoke ? 2 : 20;
const gpuFrameCount = smoke ? 6 : 120;
const settleTimeoutMs = 60_000;
const twoFramesMs = 33.4;
const reportDir = fileURLToPath(new URL("../test-results/frame-bench", import.meta.url));

interface FrameWindow {
  readonly frames: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly worstMs: number;
  readonly over33Ms: number;
}

interface Row {
  readonly slide: string;
  readonly round: number;
  readonly gpu: GpuFrames;
  readonly motion: FrameWindow;
  readonly settleMs: number;
}

test.describe.configure({ mode: "serial", timeout: 1_200_000 });

let served: Served | null = null;

test.beforeAll(async () => {
  for (const slide of slides) {
    if (fixtureAvailability(slide.file).status !== "ready") {
      throw new Error(`${slide.file} is not in the cache, run: pnpm fixtures viewer`);
    }
  }
  served = await buildAndServe();
});

test.afterAll(async () => {
  await served?.close();
  served = null;
});

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function fresh(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}${pagePath}`);
  await page.waitForFunction(
    () =>
      window.panHarness !== undefined &&
      window.j2kBench !== undefined &&
      window.frameBench !== undefined,
  );
}

function slowest<T>(rows: readonly T[], pick: (row: T) => number): number {
  return Math.max(...rows.map(pick));
}

test("frame time while panning and raster GPU time of the CI slides on the hardware GPU", async ({
  page,
}) => {
  if (served === null) throw new Error("The slide server is not running");
  const origin = served.origin;
  const loadAtStart = Number((loadavg()[0] ?? 0).toFixed(1));
  await fresh(page, origin);
  const gpu: GpuInfo = await page.evaluate(() => window.j2kBench.gpu());
  console.log(`GPU: ${gpu.renderer} (${gpu.vendor}), frame ${gpu.refreshIntervalMs.toFixed(2)} ms`);
  expect(gpu.renderer ?? "").not.toMatch(/swiftshader/i);

  const rows: Row[] = [];
  for (let round = 0; round < repetitions; round++) {
    for (const slide of slides) {
      await fresh(page, origin);
      const travel = (panPxPerSecond * panMs) / 1000;
      const request: PanSlide = {
        url: `${origin}/cache/${slide.file}`,
        formatId: slide.formatId,
        workers: 6,
        reader: "shared-bytes",
        magnification,
        micronsPerPixel: cmu1MicronsPerPixel,
        x: cmu1TissueCentre.x - travel,
        y: cmu1TissueCentre.y,
      };
      await page.evaluate((next) => window.panHarness.open(next), request);
      const gpuFrames = await page.evaluate(
        ({ warmup, frames }) => window.frameBench.gpuFrames(warmup, frames),
        { warmup: gpuWarmup, frames: gpuFrameCount },
      );
      const result = await page.evaluate(
        async ({ plan, timeout }) => {
          window.j2kBench.startFrames();
          const report = await window.panHarness.drive(plan, timeout);
          return { report, frames: window.j2kBench.stopFrames(report.elapsedMs) };
        },
        {
          plan: { pxPerSecond: panPxPerSecond, ms: panMs, zigzagPx: 0, vertical: false },
          timeout: settleTimeoutMs,
        },
      );
      await page.evaluate(() => window.panHarness.close());
      expect(result.report.errors).toEqual([]);
      rows.push({
        slide: slide.file,
        round,
        gpu: gpuFrames,
        motion: result.frames.motion,
        settleMs: result.report.settleMs,
      });
      console.log(
        `${slide.file} round ${round}: raster GPU median ${gpuFrames.medianMs.toFixed(2)} p95 ${gpuFrames.p95Ms.toFixed(2)} ms (${gpuFrames.source}); pan frame p50 ${result.frames.motion.p50Ms.toFixed(1)} p95 ${result.frames.motion.p95Ms.toFixed(1)} worst ${result.frames.motion.worstMs.toFixed(1)} ms over ${result.frames.motion.frames} frames, ${result.frames.motion.over33Ms} over ${twoFramesMs} ms, settle ${result.report.settleMs.toFixed(0)} ms`,
      );
    }
  }

  const summary = [];
  for (const slide of slides) {
    const own = rows.filter((row) => row.slide === slide.file);
    const panP95 = slowest(own, (row) => row.motion.p95Ms);
    const gpuMedian = slowest(own, (row) => row.gpu.medianMs);
    const over = own.reduce((sum, row) => sum + row.motion.over33Ms, 0);
    const pan = await budget(slide.panBudget);
    const raster = await budget(slide.gpuBudget);
    summary.push({
      slide: slide.file,
      panFrameP95Ms: panP95,
      framesOver33Ms: over,
      rasterGpuMedianMs: gpuMedian,
      panLimit: pan.limit,
      gpuLimit: raster.limit,
    });
    if (smoke) continue;
    expect.soft(over, `${slide.file} frames over ${twoFramesMs} ms`).toBe(0);
    if (pan.limit !== null) expect.soft(panP95, pan.id).toBeLessThanOrEqual(pan.limit);
    if (raster.limit !== null) expect.soft(gpuMedian, raster.id).toBeLessThanOrEqual(raster.limit);
  }

  mkdirSync(reportDir, { recursive: true });
  const file = `${reportDir}/report.json`;
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        date: new Date().toISOString().slice(0, 10),
        commit: commit(),
        smoke,
        gpu,
        loadAverage: { start: loadAtStart, end: Number((loadavg()[0] ?? 0).toFixed(1)) },
        summary,
        rows,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify(summary));
  console.log(`Report: ${file}`);
});
