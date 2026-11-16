import { fixturesDir } from "@parfocal/test-fixtures";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre } from "../../golden-images/render/viv-scenes.ts";
import { assertGpuMode } from "../../golden-images/src/playwright.ts";
import { RTT_MATRIX_MS, startLatencyProxy } from "../../latency-proxy/src/index.ts";
import type { SlideFormatId } from "../src/index.ts";
import { type Served, type ServedRequest, serve } from "../test/pixel-source/serve.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import { summarizeMainThread, traceCategories } from "./main-thread-trace.ts";
import type { PanSlide } from "./page/pan-harness.ts";
import { perfRoute, perfRouteLaunch } from "./perf-route.ts";

if (perfRouteLaunch) test.use(perfRouteLaunch);

interface BudgetIds {
  readonly fittedRequests: string;
  readonly fittedBytes: string;
  readonly fittedMs: string;
  readonly jumpRequests: string;
  readonly jumpBytes: string;
  readonly jumpMs: string;
  readonly jumpLongestTaskMs: string;
  readonly heapBytes: string;
}

interface BudgetSlide {
  readonly file: string;
  readonly formatId: SlideFormatId;
  readonly ids: BudgetIds;
}

const slides: readonly BudgetSlide[] = [
  {
    file: "CMU-1.svs",
    formatId: "aperio-svs",
    ids: {
      fittedRequests: "viewer.fitted-requests",
      fittedBytes: "viewer.fitted-bytes",
      fittedMs: "viewer.fitted-ms",
      jumpRequests: "viewer.jump-requests",
      jumpBytes: "viewer.jump-bytes",
      jumpMs: "viewer.jump-sharp-ms",
      jumpLongestTaskMs: "viewer.jump-longest-task-ms",
      heapBytes: "viewer.heap-bytes",
    },
  },
  {
    file: "CMU-1-JP2K-33005.svs",
    formatId: "aperio-svs",
    ids: {
      fittedRequests: "viewer.jp2k.fitted-requests",
      fittedBytes: "viewer.jp2k.fitted-bytes",
      fittedMs: "viewer.jp2k.fitted-ms",
      jumpRequests: "viewer.jp2k.jump-requests",
      jumpBytes: "viewer.jp2k.jump-bytes",
      jumpMs: "viewer.jp2k.jump-sharp-ms",
      jumpLongestTaskMs: "viewer.jp2k.jump-longest-task-ms",
      heapBytes: "viewer.jp2k.heap-bytes",
    },
  },
  {
    file: "CMU-1.tiff",
    formatId: "generic-tiff",
    ids: {
      fittedRequests: "viewer.tiff.fitted-requests",
      fittedBytes: "viewer.tiff.fitted-bytes",
      fittedMs: "viewer.tiff.fitted-ms",
      jumpRequests: "viewer.tiff.jump-requests",
      jumpBytes: "viewer.tiff.jump-bytes",
      jumpMs: "viewer.tiff.jump-sharp-ms",
      jumpLongestTaskMs: "viewer.tiff.jump-longest-task-ms",
      heapBytes: "viewer.tiff.heap-bytes",
    },
  },
];

const repetitions = 3;
const settleTimeoutMs = 60_000;
const cpuRttMs = 0;
const jumpTarget = { magnification: 10, micronsPerPixel: cmu1MicronsPerPixel, ...cmu1TissueCentre };

interface Phase {
  readonly ms: number;
  readonly requests: number;
  readonly bytes: number;
}

interface Cpu {
  readonly jumpLongestTaskMs: number;
  readonly heapBytes: number;
}

interface Sample {
  readonly fitted: Phase;
  readonly jump: Phase;
  readonly cpu: Cpu | null;
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

let served: Served | null = null;

test.beforeAll(async () => {
  for (const slide of slides) {
    const availability = fixtureAvailability(slide.file);
    if (availability.status === "missing" && availability.required) {
      throw new Error(availability.message);
    }
  }
  served = await serve(
    { "/app": outDir, "/cache": fixturesDir() },
    { headers: crossOriginIsolated },
  );
});

test.afterAll(async () => {
  await served?.close();
  served = null;
});

function slideTraffic(entries: readonly ServedRequest[], path: string): Omit<Phase, "ms"> {
  const slide = entries.filter((entry) => entry.path === path);
  return {
    requests: slide.length,
    bytes: slide.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

async function heapBytes(page: Page): Promise<number> {
  const bytes = await page.evaluate(async () => {
    const measure = (
      performance as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }
    ).measureUserAgentSpecificMemory;
    if (!crossOriginIsolated || !measure) return null;
    return (await measure.call(performance)).bytes;
  });
  if (bytes === null) throw new Error("measureUserAgentSpecificMemory is not available");
  return bytes;
}

async function sample(
  page: Page,
  browser: Browser,
  origin: string,
  slide: BudgetSlide,
  measureCpu: boolean,
): Promise<Sample> {
  if (served === null) throw new Error("The slide server is not running");
  const log = served.log;
  const path = `/cache/${slide.file}`;
  await page.goto(`${origin}/app/pan.html`);
  await page.waitForFunction(() => window.panHarness !== undefined);
  const start = log.length;
  const request: PanSlide = {
    route: perfRoute,
    url: `${origin}${path}`,
    formatId: slide.formatId,
    workers: 6,
    reader: "shared-bytes",
    magnification: null,
    ...cmu1TissueCentre,
  };
  const opened = await page.evaluate((next) => window.panHarness.open(next), request);
  const fittedAt = log.length;
  if (measureCpu) await browser.startTracing(undefined, { categories: [...traceCategories] });
  const jumped = await page.evaluate(
    ({ target, timeout }) => window.panHarness.jump(target, timeout),
    { target: jumpTarget, timeout: settleTimeoutMs },
  );
  const trace = measureCpu ? summarizeMainThread(await browser.stopTracing()) : null;
  const heap = measureCpu ? await heapBytes(page) : 0;
  await page.evaluate(() => window.panHarness.close());
  expect(jumped.errors).toEqual([]);
  return {
    fitted: { ms: opened.openMs, ...slideTraffic(log.slice(start, fittedAt), path) },
    jump: { ms: jumped.sharpMs, ...slideTraffic(log.slice(fittedAt), path) },
    cpu:
      trace === null
        ? null
        : {
            jumpLongestTaskMs: trace.longestPageMs,
            heapBytes: heap,
          },
  };
}

function fastest(samples: readonly Sample[], phase: "fitted" | "jump"): Phase {
  const phases = samples.map((entry) => entry[phase]);
  return {
    ms: Math.min(...phases.map((entry) => entry.ms)),
    requests: Math.max(...phases.map((entry) => entry.requests)),
    bytes: Math.max(...phases.map((entry) => entry.bytes)),
  };
}

function cpuOf(samples: readonly Sample[]): Cpu | null {
  const cpu = samples.flatMap((entry) => (entry.cpu === null ? [] : [entry.cpu]));
  if (cpu.length === 0) return null;
  return {
    jumpLongestTaskMs: Math.min(...cpu.map((entry) => entry.jumpLongestTaskMs)),
    heapBytes: Math.max(...cpu.map((entry) => entry.heapBytes)),
  };
}

for (const slide of slides) {
  for (const rttMs of RTT_MATRIX_MS) {
    test(`${slide.file} reaches the fitted image and sharp after a jump to 10x within budget at ${rttMs} ms RTT`, async ({
      page,
      browser,
    }, testInfo) => {
      const availability = fixtureAvailability(slide.file);
      test.skip(
        availability.status === "missing",
        availability.status === "missing" ? availability.message : "",
      );
      if (served === null) throw new Error("The slide server is not running");
      await page.setContent("<!doctype html><html><body></body></html>");
      await assertGpuMode(page);
      const proxy = await startLatencyProxy({ target: served.origin, rttMs });
      const measureCpu = rttMs === cpuRttMs;
      const samples: Sample[] = [];
      try {
        for (let round = 0; round < repetitions; round++) {
          samples.push(await sample(page, browser, proxy.url, slide, measureCpu));
        }
      } finally {
        await proxy.close();
      }
      const fitted = fastest(samples, "fitted");
      const jump = fastest(samples, "jump");
      const cpu = cpuOf(samples);
      const cpuText =
        cpu === null
          ? ""
          : `; jump longest task ${cpu.jumpLongestTaskMs.toFixed(1)} ms, heap ${cpu.heapBytes} B`;
      const description = `${slide.file} rtt ${rttMs} ms, fastest of ${repetitions}: fitted ${fitted.ms.toFixed(0)} ms, ${fitted.requests} requests, ${fitted.bytes} B; sharp after jump ${jump.ms.toFixed(0)} ms, ${jump.requests} requests, ${jump.bytes} B${cpuText}`;
      testInfo.annotations.push({ type: "perf", description });
      console.log(description);
      const { ids } = slide;
      const measured: [string, number][] = [
        [ids.fittedRequests, fitted.requests],
        [ids.fittedBytes, fitted.bytes],
        [ids.fittedMs, fitted.ms],
        [ids.jumpRequests, jump.requests],
        [ids.jumpBytes, jump.bytes],
        [ids.jumpMs, jump.ms],
      ];
      if (cpu !== null) {
        measured.push(
          [ids.jumpLongestTaskMs, cpu.jumpLongestTaskMs],
          [ids.heapBytes, cpu.heapBytes],
        );
      }
      for (const [id, value] of measured) {
        await checkBudget(id, value, { rttMs });
      }
    });
  }
}

const mainPathRuns = Number(process.env["PARFOCAL_MAIN_PATH_RUNS"] ?? 0);
const mainPathRttMs = 50;

function nearestRank(values: readonly number[], share: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * share) - 1)] ?? Number.NaN;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle] ?? Number.NaN;
  return ordered.length % 2 === 1 ? upper : ((ordered[middle - 1] ?? Number.NaN) + upper) / 2;
}

test("CMU-1.svs open and jump after a warm-up, median and p95 for the main path budgets", async ({
  page,
  browser,
}) => {
  test.skip(mainPathRuns === 0, "set PARFOCAL_MAIN_PATH_RUNS to a count");
  test.setTimeout(120_000 + mainPathRuns * 30_000);
  const slide = slides[0];
  if (slide === undefined || served === null) throw new Error("The slide server is not running");
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertGpuMode(page);
  const proxy = await startLatencyProxy({ target: served.origin, rttMs: mainPathRttMs });
  const samples: Sample[] = [];
  try {
    await sample(page, browser, proxy.url, slide, false);
    for (let round = 0; round < mainPathRuns; round++) {
      samples.push(await sample(page, browser, proxy.url, slide, false));
    }
  } finally {
    await proxy.close();
  }
  const summary = (phase: "fitted" | "jump") => {
    const ms = samples.map((entry) => entry[phase].ms);
    return { ms, median: median(ms), p95: nearestRank(ms, 0.95) };
  };
  const fitted = summary("fitted");
  const jump = summary("jump");
  console.log(
    JSON.stringify({ slide: slide.file, rttMs: mainPathRttMs, runs: mainPathRuns, fitted, jump }),
  );
  expect(fitted.ms.length).toBe(mainPathRuns);
  for (const [id, p95] of [
    ["app.open-fitted-p95-ms", fitted.p95],
    ["app.jump-sharp-p95-ms", jump.p95],
  ] as const) {
    test.info().annotations.push({ type: "main-path", description: `${id} ${p95.toFixed(0)} ms` });
  }
});
