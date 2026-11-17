import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { SlideFormatId } from "../src/index.ts";
import { differingPixels } from "./differing-pixels.ts";
import { gpuOriginVariable, nucleiFileVariable } from "./global-setup.ts";
import type { CaseReport, CaseRequest, FrameStats, GpuInfo } from "./page/gpu-timing-harness.ts";

interface TimedCase extends CaseReport {
  readonly withoutAfter: FrameStats;
  readonly overlayDeltaAfterMs: number;
  readonly overlayPixels: number;
}

const reportDir = fileURLToPath(new URL("../test-results/gpu-timing", import.meta.url));
const smoke = process.env["GPU_TIMING_SMOKE"] === "1";

const overviewBudgetMs = 1;
const detailBudgetMs = 6;

const cases: readonly CaseRequest[] = [
  {
    name: "overview-81k",
    perRow: smoke ? 40 : 285,
    diameterPx: 1,
    frames: smoke ? 6 : 120,
    warmup: smoke ? 2 : 20,
  },
  {
    name: "detail-1.6m",
    perRow: smoke ? 60 : 1265,
    diameterPx: 20,
    frames: smoke ? 6 : 120,
    warmup: smoke ? 2 : 20,
  },
];

function commit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function row(label: string, measured: number, budget: number): string {
  const word = measured < budget ? "under" : "OVER";
  return `${label.padEnd(44)} ${measured.toFixed(2).padStart(7)} ms  budget ${budget} ms  ${word}`;
}

function origin(): string {
  const served = process.env[gpuOriginVariable];
  if (!served) throw new Error("Run through pnpm gpu-timing");
  return served;
}

async function timeCases(
  page: Page,
  slide: { readonly path: string; readonly formatId: SlideFormatId },
  requests: readonly CaseRequest[],
): Promise<{ info: GpuInfo; reports: TimedCase[] }> {
  await page.goto(`${origin()}/app/gpu-timing.html`);
  await page.waitForFunction(() => window.gpuTiming !== undefined);
  const info: GpuInfo = await page.evaluate(
    ({ url, formatId }) => window.gpuTiming.open(url, formatId),
    { url: `${origin()}${slide.path}`, formatId: slide.formatId },
  );
  const reports: TimedCase[] = [];
  const canvas = page.locator("#viewer canvas").first();
  for (const request of requests) {
    const report = await page.evaluate((r) => window.gpuTiming.run(r), request);
    const shown = await canvas.screenshot();
    const withoutAfter = await page.evaluate((r) => window.gpuTiming.withoutAgain(r), request);
    const bare = await canvas.screenshot();
    reports.push({
      ...report,
      withoutAfter,
      overlayDeltaAfterMs: report.withOverlay.medianMs - withoutAfter.medianMs,
      overlayPixels: differingPixels(shown, bare),
    });
  }
  await page.evaluate(() => window.gpuTiming.close());
  return { info, reports };
}

function caseLine(report: TimedCase): string {
  const drawn = report.drawnLayers
    .map((layer) => `${layer.id.replace("overlay:nuclei:", "")} ${layer.length}`)
    .join(", ");
  return `${report.name}: ${report.nuclei} nuclei, with ${report.withOverlay.medianMs.toFixed(2)} ms, without before ${report.withoutOverlay.medianMs.toFixed(2)} ms, without after ${report.withoutAfter.medianMs.toFixed(2)} ms, overlay pixels ${report.overlayPixels}, drawn ${drawn}`;
}

test("81k real nuclei of Huron-1-40x at overview against the overlay budget", async ({ page }) => {
  const packed = process.env[nucleiFileVariable];
  test.skip(packed === undefined, `Set ${nucleiFileVariable} to a file from pack-poc-nuclei.py`);
  const { info, reports } = await timeCases(
    page,
    { path: "/cache/Huron-1-40x.tif", formatId: "huron-tiff" },
    [
      {
        name: "overview-real",
        perRow: 0,
        diameterPx: 0,
        frames: smoke ? 6 : 120,
        warmup: smoke ? 2 : 20,
        nucleiUrl: `${origin()}/nuclei/${basename(packed ?? "")}`,
      },
    ],
  );
  const real = reports[0];
  if (real === undefined) throw new Error("The case did not run");
  const overlayMs = Math.max(real.overlayDeltaMs, real.overlayDeltaAfterMs);
  mkdirSync(reportDir, { recursive: true });
  const file = `${reportDir}/real-nuclei.json`;
  writeFileSync(
    file,
    `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), commit: commit(), smoke, gpu: info, overlayMs, cases: reports }, null, 2)}\n`,
  );
  console.log(
    `\nGPU: ${info.renderer ?? "unknown"}, slide ${info.slide.width}x${info.slide.height}`,
  );
  console.log(caseLine(real));
  console.log(row("Overview, real nuclei, overlay GPU time", overlayMs, overviewBudgetMs));
  console.log(`Report: ${file}\n`);
  expect(real.errors).toEqual([]);
  expect(real.overlayPixels).toBeGreaterThan(0);
  if (smoke) return;
  expect.soft(overlayMs).toBeLessThan(overviewBudgetMs);
});

test("the overlay GPU time at overview and at detail zoom against their budgets", async ({
  page,
}) => {
  const { info, reports } = await timeCases(
    page,
    { path: "/synthetic/synthetic-zlib.ome.tiff", formatId: "ome-tiff" },
    cases,
  );

  const overview = reports[0];
  const detail = reports[1];
  if (overview === undefined || detail === undefined) throw new Error("A case did not run");
  const overviewOverlayMs = Math.max(overview.overlayDeltaMs, overview.overlayDeltaAfterMs);
  const checks = {
    overviewOverlayMs: { measured: overviewOverlayMs, budget: overviewBudgetMs },
    detailFrameMs: { measured: detail.withOverlay.medianMs, budget: detailBudgetMs },
  };
  const report = {
    date: new Date().toISOString().slice(0, 10),
    commit: commit(),
    smoke,
    timingSource: { overview: overview.source, detail: detail.source },
    gpu: info,
    checks: {
      overviewOverlayMs: {
        ...checks.overviewOverlayMs,
        passed: checks.overviewOverlayMs.measured < overviewBudgetMs,
      },
      detailFrameMs: {
        ...checks.detailFrameMs,
        passed: checks.detailFrameMs.measured < detailBudgetMs,
      },
    },
    cases: reports,
  };
  mkdirSync(reportDir, { recursive: true });
  const file = `${reportDir}/report.json`;
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`\nGPU: ${info.renderer ?? "unknown"} (${info.vendor ?? "unknown"})`);
  console.log(
    `Canvas ${info.canvas.width}x${info.canvas.height}, devicePixelRatio ${info.devicePixelRatio}, timing by ${overview.source}${smoke ? " (smoke sizes, not a measurement)" : ""}`,
  );
  for (const report of reports) console.log(caseLine(report));
  console.log(row("Overview, 81k nuclei, overlay GPU time", overviewOverlayMs, overviewBudgetMs));
  console.log(
    row(
      "Detail zoom, 1.6M nuclei, Viv route GPU time",
      detail.withOverlay.medianMs,
      detailBudgetMs,
    ),
  );
  console.log(`Detail overlay share: ${detail.overlayDeltaMs.toFixed(2)} ms. Report: ${file}\n`);

  expect(overview.errors).toEqual([]);
  expect(detail.errors).toEqual([]);
  expect(overview.overlayPixels).toBeGreaterThan(0);
  expect(detail.overlayPixels).toBeGreaterThan(0);
  if (smoke) return;
  expect.soft(overviewOverlayMs).toBeLessThan(overviewBudgetMs);
  expect.soft(detail.withOverlay.medianMs).toBeLessThan(detailBudgetMs);
});
