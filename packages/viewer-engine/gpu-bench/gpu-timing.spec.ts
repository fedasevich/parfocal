import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { gpuOriginVariable } from "./global-setup.ts";
import type { CaseReport, CaseRequest, GpuInfo } from "./page/gpu-timing-harness.ts";

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

test("the overlay GPU time at overview and at detail zoom against their budgets", async ({
  page,
}) => {
  const origin = process.env[gpuOriginVariable];
  if (!origin) throw new Error("Run through pnpm gpu-timing");
  await page.goto(`${origin}/app/gpu-timing.html`);
  await page.waitForFunction(() => window.gpuTiming !== undefined);
  const info: GpuInfo = await page.evaluate(
    (url) => window.gpuTiming.open(url),
    `${origin}/synthetic/synthetic-zlib.ome.tiff`,
  );
  const reports: CaseReport[] = [];
  for (const request of cases) {
    reports.push(await page.evaluate((r) => window.gpuTiming.run(r), request));
  }
  await page.evaluate(() => window.gpuTiming.close());

  const overview = reports[0];
  const detail = reports[1];
  if (overview === undefined || detail === undefined) throw new Error("A case did not run");
  const checks = {
    overviewOverlayMs: { measured: overview.overlayDeltaMs, budget: overviewBudgetMs },
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
  console.log(
    row("Overview, 81k nuclei, overlay GPU time", overview.overlayDeltaMs, overviewBudgetMs),
  );
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
  if (smoke) return;
  expect.soft(overview.overlayDeltaMs).toBeLessThan(overviewBudgetMs);
  expect.soft(detail.withOverlay.medianMs).toBeLessThan(detailBudgetMs);
});
