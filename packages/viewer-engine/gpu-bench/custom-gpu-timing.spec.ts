import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { differingPixels } from "./differing-pixels.ts";
import { gpuOriginVariable } from "./global-setup.ts";
import type { CustomCaseReport, CustomGpuInfo } from "./page/custom-gpu-timing-harness.ts";
import type { CaseRequest } from "./page/gpu-timing-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/gpu-timing", import.meta.url));
const smoke = process.env["GPU_TIMING_SMOKE"] === "1";

const overviewBudgetMs = 1;
const detailBudgetMs = 6;

const cases: readonly CaseRequest[] = [
  {
    name: "overview-81k",
    perRow: smoke ? 40 : 285,
    diameterPx: 1,
    frames: smoke ? 6 : 60,
    warmup: smoke ? 2 : 10,
  },
  {
    name: "dots-160k",
    perRow: smoke ? 40 : 400,
    diameterPx: 4,
    frames: smoke ? 6 : 60,
    warmup: smoke ? 2 : 10,
  },
  {
    name: "detail-1.6m",
    perRow: smoke ? 60 : 1265,
    diameterPx: 20,
    frames: smoke ? 6 : 60,
    warmup: smoke ? 2 : 10,
  },
];

test.use({ launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] } });

test("the custom WebGPU route's GPU time at overview and at detail zoom", async ({ page }) => {
  const origin = process.env[gpuOriginVariable];
  if (!origin) throw new Error("Run through pnpm gpu-timing");
  await page.goto(`${origin}/app/custom-gpu-timing.html`);
  await page.waitForFunction(() => window.customGpuTiming !== undefined);
  const info: CustomGpuInfo = await page.evaluate(
    (url) => window.customGpuTiming.open(url),
    `${origin}/synthetic/synthetic-zlib.ome.tiff`,
  );
  const reports: (CustomCaseReport & { readonly overlayPixels: number })[] = [];
  const canvas = page.locator("#viewer canvas");
  for (const request of cases) {
    const report = await page.evaluate((r) => window.customGpuTiming.run(r), request);
    const shown = await canvas.screenshot();
    await page.evaluate(() => window.customGpuTiming.clearOverlays());
    const bare = await canvas.screenshot();
    reports.push({ ...report, overlayPixels: differingPixels(shown, bare) });
  }
  await page.evaluate(() => window.customGpuTiming.close());

  mkdirSync(reportDir, { recursive: true });
  const file = `${reportDir}/custom-webgpu.json`;
  writeFileSync(file, `${JSON.stringify({ smoke, gpu: info, cases: reports }, null, 2)}\n`);
  console.log(
    `\nCanvas ${info.canvas.width}x${info.canvas.height}, devicePixelRatio ${info.devicePixelRatio}${smoke ? " (smoke size)" : ""}`,
  );
  for (const report of reports) {
    console.log(
      `${report.name}: ${report.nuclei} nuclei, with overlay median ${report.withOverlay.medianMs.toFixed(2)} ms p95 ${report.withOverlay.p95Ms.toFixed(2)} ms (${report.withOverlay.samples} samples), without ${report.withoutOverlay.medianMs.toFixed(2)} ms, overlay share ${report.overlayDeltaMs.toFixed(2)} ms, build ${report.buildBatchMs.toFixed(0)} ms, errors ${report.errors.length}, uncaptured ${report.uncapturedGpuErrors}, overlay pixels ${report.overlayPixels}`,
    );
    for (const error of report.errors) console.log(`  ${error}`);
  }
  console.log(
    `Budgets: overview overlay ${overviewBudgetMs} ms, detail frame ${detailBudgetMs} ms. Report: ${file}\n`,
  );

  for (const report of reports) {
    expect(report.withOverlay.samples, report.name).toBeGreaterThan(0);
    expect(report.withoutOverlay.samples, report.name).toBeGreaterThan(0);
    expect(report.overlayPixels, report.name).toBeGreaterThan(0);
    expect(report.errors, report.name).toEqual([]);
    expect(report.uncapturedGpuErrors, report.name).toBe(0);
  }
});
