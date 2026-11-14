import { fixturesDir } from "@parfocal/test-fixtures";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { checkBudget } from "../../../scripts/perf-budgets.ts";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { type Served, serve } from "../test/pixel-source/serve.ts";
import { crossOriginIsolated, outDir } from "./global-setup.ts";
import { summarizeMainThread, traceCategories } from "./main-thread-trace.ts";
import type { FrameReport, PanSlide } from "./page/pan-harness.ts";

const slides = [
  { file: "Huron-1-40x.tif", budget: "viewer.wheel-zoom-longest-task-ms" },
  {
    file: "Huron-1-Uncompressed.tif",
    budget: "viewer.wheel-zoom-uncompressed-longest-task-ms",
  },
] as const;
const repetitions = 3;
const notches = 12;
const notchGapMs = 40;
const notchDeltaY = -100;
const availabilities = slides.map((slide) => fixtureAvailability(slide.file));

test.describe.configure({ mode: "serial", timeout: 240_000 });

let served: Served | null = null;

test.beforeAll(async () => {
  for (const availability of availabilities) {
    if (availability.status === "missing" && availability.required) {
      throw new Error(availability.message);
    }
  }
  if (availabilities.every((availability) => availability.status !== "ready")) return;
  served = await serve(
    { "/app": outDir, "/cache": fixturesDir() },
    { headers: crossOriginIsolated },
  );
});

test.afterAll(async () => {
  await served?.close();
  served = null;
});

interface Run {
  readonly before: number;
  readonly report: FrameReport;
  readonly longestTaskMs: number;
}

async function zoomRun(
  page: Page,
  browser: Browser,
  origin: string,
  slideFile: string,
): Promise<Run> {
  await page.goto(`${origin}/app/pan.html`);
  await page.waitForFunction(() => window.panHarness !== undefined);
  const slide: PanSlide = {
    url: `${origin}/cache/${slideFile}`,
    formatId: "huron-tiff",
    workers: 6,
    reader: "shared-bytes",
    magnification: null,
    x: 0,
    y: 0,
  };
  await page.evaluate((next) => window.panHarness.open(next), slide);
  await page.evaluate(() => window.panHarness.bindWheel());
  const before = await page.evaluate(() => window.panHarness.rest());
  const cdp = await page.context().newCDPSession(page);
  await browser.startTracing(undefined, { categories: [...traceCategories] });
  await page.evaluate(() => window.panHarness.startFrames());
  for (let notch = 0; notch < notches; notch++) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 640,
      y: 360,
      deltaX: 0,
      deltaY: notchDeltaY,
    });
    await page.waitForTimeout(notchGapMs);
  }
  const report = await page.evaluate(() => window.panHarness.stopFrames());
  const trace = summarizeMainThread(await browser.stopTracing());
  await page.evaluate(() => window.panHarness.close());
  return { before: before.zoom, report, longestTaskMs: trace.longestPageMs };
}

for (const [index, slide] of slides.entries()) {
  test(`wheel zoom on ${slide.file} keeps the longest main-thread task within budget`, async ({
    page,
    browser,
  }, testInfo) => {
    const availability = availabilities[index];
    test.skip(
      availability?.status === "missing",
      availability?.status === "missing" ? availability.message : "",
    );
    if (served === null) throw new Error("The slide server is not running");
    await page.setContent("<!doctype html><html><body></body></html>");
    await assertSwiftShader(page);
    const runs: Run[] = [];
    for (let round = 0; round < repetitions; round++) {
      runs.push(await zoomRun(page, browser, served.origin, slide.file));
    }
    for (const run of runs) expect(run.report.camera.zoom).toBeGreaterThan(run.before);
    const worst = Math.min(...runs.map((run) => run.longestTaskMs));
    const description = `fastest of ${repetitions}: longest main-thread task ${worst.toFixed(1)} ms; runs ${runs
      .map(
        (run) =>
          `${run.longestTaskMs.toFixed(1)} ms longest task, ${run.report.worstMs.toFixed(1)} ms worst frame gap, ${run.report.p95Ms.toFixed(1)} ms p95, ${run.report.frames} frames`,
      )
      .join("; ")}`;
    testInfo.annotations.push({ type: "perf", description });
    console.log(description);
    await checkBudget(slide.budget, worst);
  });
}
