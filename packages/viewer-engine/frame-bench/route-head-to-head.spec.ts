import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import type { JumpTarget, PanSlide } from "../browser/page/pan-harness.ts";
import type { GpuInfo } from "../j2k-bench/page/j2k-bench-harness.ts";
import type { RendererRouteId } from "../src/index.ts";
import type { Served } from "../test/pixel-source/serve.ts";
import { buildAndServe, pagePath } from "./global-setup.ts";
import type { RouteGpuFrames } from "./page/route-bench-harness.ts";

const routes: readonly RendererRouteId[] = ["viv", "deck-webgpu", "custom-webgpu"];
const slideFile = "CMU-1.svs";
const smoke = process.env["FRAME_BENCH_SMOKE"] === "1";
const repetitions = smoke ? 1 : 3;
const panMagnification = 10;
const stops: readonly number[] = [2, 10, 20];
const panPxPerSecond = 1000;
const panMs = smoke ? 500 : 3000;
const gpuWarmup = smoke ? 2 : 20;
const gpuFrameCount = smoke ? 6 : 120;
const settleTimeoutMs = 60_000;
const minimumTissueShare = 0.2;
const minimumLumaSpread = 8;
const reportDir = fileURLToPath(new URL("../test-results/route-bench", import.meta.url));

interface Pixels {
  readonly tissueShare: number;
  readonly lumaSpread: number;
  readonly rgba: Uint8Array;
}

interface Stop {
  readonly magnification: number;
  readonly settleMs: number;
  readonly gpu: RouteGpuFrames;
  readonly tissueShare: number;
  readonly lumaSpread: number;
  readonly meanDifferenceFromViv: number | null;
}

interface Row {
  readonly route: RendererRouteId;
  readonly round: number;
  readonly openMs: number;
  readonly stops: readonly Stop[];
  readonly pan: { frames: number; p50Ms: number; p95Ms: number; worstMs: number; over33Ms: number };
  readonly panSettleMs: number;
  readonly afterPanTissueShare: number;
  readonly uncapturedGpuErrors: number;
}

test.describe.configure({ mode: "serial", timeout: 1_800_000 });

let served: Served | null = null;

test.beforeAll(async () => {
  if (fixtureAvailability(slideFile).status !== "ready") {
    throw new Error(`${slideFile} is not in the cache, run: pnpm fixtures viewer`);
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
      window.frameBench !== undefined &&
      window.routeBench !== undefined,
  );
}

async function pixels(page: Page): Promise<Pixels> {
  const image = PNG.sync.read(await page.locator("#viewer").screenshot());
  const data = image.data;
  const count = image.width * image.height;
  let tissue = 0;
  let sum = 0;
  let squares = 0;
  for (let index = 0; index < count; index++) {
    const red = data[index * 4] ?? 0;
    const green = data[index * 4 + 1] ?? 0;
    const blue = data[index * 4 + 2] ?? 0;
    if (Math.min(red, green, blue) < 231) tissue++;
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    sum += luma;
    squares += luma * luma;
  }
  const mean = sum / count;
  return {
    tissueShare: tissue / count,
    lumaSpread: Math.sqrt(Math.max(0, squares / count - mean * mean)),
    rgba: new Uint8Array(data),
  };
}

function meanDifference(a: Uint8Array, b: Uint8Array): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let total = 0;
  for (let index = 0; index < a.length; index += 4) {
    total +=
      Math.abs((a[index] ?? 0) - (b[index] ?? 0)) +
      Math.abs((a[index + 1] ?? 0) - (b[index + 1] ?? 0)) +
      Math.abs((a[index + 2] ?? 0) - (b[index + 2] ?? 0));
  }
  return total / ((a.length / 4) * 3);
}

function expectDrawn(shot: Pixels, label: string): void {
  expect(shot.tissueShare, `${label} tissue share`).toBeGreaterThan(minimumTissueShare);
  expect(shot.lumaSpread, `${label} luma spread`).toBeGreaterThan(minimumLumaSpread);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

test("Viv, deck.gl WebGPU and custom WebGPU on the same camera path on the hardware GPU", async ({
  page,
}) => {
  if (served === null) throw new Error("The slide server is not running");
  const origin = served.origin;
  const loadAtStart = Number((loadavg()[0] ?? 0).toFixed(1));
  await fresh(page, origin);
  const gpu: GpuInfo = await page.evaluate(() => window.j2kBench.gpu());
  const adapter = await page.evaluate(async () => {
    const found = await navigator.gpu?.requestAdapter();
    if (!found) return null;
    return { fallback: found.info.isFallbackAdapter ?? false, vendor: found.info.vendor };
  });
  console.log(`GPU: ${gpu.renderer} (${gpu.vendor}), WebGPU ${JSON.stringify(adapter)}`);
  expect(gpu.renderer ?? "").not.toMatch(/swiftshader/i);
  expect(adapter?.fallback).toBe(false);

  const vivShots = new Map<string, Uint8Array>();
  const rows: Row[] = [];
  const travel = (panPxPerSecond * panMs) / 1000;
  for (let round = 0; round < repetitions; round++) {
    for (const route of routes) {
      await fresh(page, origin);
      const request: PanSlide = {
        url: `${origin}/cache/${slideFile}`,
        formatId: "aperio-svs",
        workers: 6,
        reader: "shared-bytes",
        magnification: panMagnification,
        micronsPerPixel: cmu1MicronsPerPixel,
        route,
        x: cmu1TissueCentre.x - travel,
        y: cmu1TissueCentre.y,
      };
      const opened = await page.evaluate((next) => window.panHarness.open(next), request);

      const pan = await page.evaluate(
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
      expect(pan.report.errors).toEqual([]);
      const afterPan = await pixels(page);
      expectDrawn(afterPan, `${route} round ${round} after the pan`);

      const visited: Stop[] = [];
      for (const magnification of stops) {
        const target: JumpTarget = {
          magnification,
          micronsPerPixel: cmu1MicronsPerPixel,
          x: cmu1TissueCentre.x,
          y: cmu1TissueCentre.y,
        };
        const jumped = await page.evaluate(
          ({ next, timeout }) => window.panHarness.jump(next, timeout),
          { next: target, timeout: settleTimeoutMs },
        );
        expect(jumped.errors).toEqual([]);
        const shot = await pixels(page);
        expectDrawn(shot, `${route} round ${round} at ${magnification}x`);
        const key = `${round}:${magnification}`;
        if (route === "viv") vivShots.set(key, shot.rgba);
        const vivShot = vivShots.get(key);
        const frames = await page.evaluate(
          ({ id, warmup, count }) => window.routeBench.gpuFrames(id, warmup, count),
          { id: route, warmup: gpuWarmup, count: gpuFrameCount },
        );
        expectDrawn(
          await pixels(page),
          `${route} round ${round} at ${magnification}x after timing`,
        );
        visited.push({
          magnification,
          settleMs: jumped.sharpMs,
          gpu: frames,
          tissueShare: shot.tissueShare,
          lumaSpread: shot.lumaSpread,
          meanDifferenceFromViv:
            route === "viv" || vivShot === undefined ? null : meanDifference(shot.rgba, vivShot),
        });
      }
      const uncapturedGpuErrors = await page.evaluate(() =>
        window.routeBench.uncapturedGpuErrors(),
      );
      expect(uncapturedGpuErrors).toBe(0);
      await page.evaluate(() => window.panHarness.close());
      const row: Row = {
        route,
        round,
        openMs: opened.openMs,
        stops: visited,
        pan: pan.frames.motion,
        panSettleMs: pan.report.settleMs,
        afterPanTissueShare: afterPan.tissueShare,
        uncapturedGpuErrors,
      };
      rows.push(row);
      console.log(
        `${route} round ${round}: open ${opened.openMs.toFixed(0)} ms; pan p50 ${row.pan.p50Ms.toFixed(1)} p95 ${row.pan.p95Ms.toFixed(1)} worst ${row.pan.worstMs.toFixed(1)} over 33 ms ${row.pan.over33Ms} of ${row.pan.frames}; ${visited
          .map(
            (stop) =>
              `${stop.magnification}x gpu ${stop.gpu.medianMs.toFixed(2)}/${stop.gpu.p95Ms.toFixed(2)} ms (${stop.gpu.source}) settle ${stop.settleMs.toFixed(0)} ms diff ${stop.meanDifferenceFromViv?.toFixed(1) ?? "-"}`,
          )
          .join("; ")}`,
      );
    }
  }

  const summary = routes.map((route) => {
    const own = rows.filter((row) => row.route === route);
    return {
      route,
      openMs: median(own.map((row) => row.openMs)),
      panP50Ms: median(own.map((row) => row.pan.p50Ms)),
      panP95Ms: Math.max(...own.map((row) => row.pan.p95Ms)),
      panWorstMs: Math.max(...own.map((row) => row.pan.worstMs)),
      panFrames: own.reduce((sum, row) => sum + row.pan.frames, 0),
      panOver33Ms: own.reduce((sum, row) => sum + row.pan.over33Ms, 0),
      stops: stops.map((magnification) => {
        const at = own.flatMap((row) =>
          row.stops.filter((stop) => stop.magnification === magnification),
        );
        return {
          magnification,
          source: at[0]?.gpu.source ?? null,
          gpuMedianMs: median(at.map((stop) => stop.gpu.medianMs)),
          gpuP95Ms: Math.max(...at.map((stop) => stop.gpu.p95Ms)),
          settleMs: median(at.map((stop) => stop.settleMs)),
          meanDifferenceFromViv:
            route === "viv" ? null : median(at.map((stop) => stop.meanDifferenceFromViv ?? 0)),
        };
      }),
    };
  });

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
        adapter,
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
