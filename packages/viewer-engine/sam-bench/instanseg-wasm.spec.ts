import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { benchOriginVariable, instansegDir, instansegGraph } from "./global-setup.ts";
import type { InstanSegBenchReport, InstanSegBenchRequest } from "./page/instanseg-harness.ts";

const appThreads = 0;

const reportDir = fileURLToPath(new URL("../test-results/sam-bench", import.meta.url));
const tileAtModelScale = 256;
const tileBudgetMs = 1000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

const threadCounts = [1, 2, 4, appThreads] as const;
const reports = new Map<number, InstanSegBenchReport>();

for (const threads of threadCounts) {
  test(`InstanSeg network runs a 512 px tile on WebAssembly with ${threads === appThreads ? "the app's" : threads} threads`, async ({
    page,
  }) => {
    test.skip(
      !existsSync(join(instansegDir(), instansegGraph)),
      `run pnpm --filter @parfocal/ml export:instanseg first`,
    );
    const origin = process.env[benchOriginVariable];
    if (!origin)
      throw new Error("Run the bench through playwright test -c playwright.sam.config.ts");

    await page.goto(`${origin}/app/instanseg.html`);
    await page.waitForFunction(() => window.instansegBench !== undefined);
    const request: InstanSegBenchRequest = {
      graphUrl: `${origin}/instanseg/${instansegGraph}`,
      sides: [tileAtModelScale, 512],
      threads,
      runs: 6,
    };
    const report: InstanSegBenchReport = await page.evaluate(
      (r) => window.instansegBench.run(r),
      request,
    );

    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      `${reportDir}/instanseg-wasm-${threads}.json`,
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      JSON.stringify({
        threads,
        hardwareConcurrency: report.hardwareConcurrency,
        crossOriginIsolated: report.crossOriginIsolated,
        timings: report.timings.map((timing) => ({
          side: timing.side,
          createMs: Math.round(timing.createMs),
          firstMs: Math.round(timing.runsMs[0] ?? Number.NaN),
          steadyMs: Math.round(median(timing.runsMs.slice(1))),
        })),
      }),
    );

    expect(report.crossOriginIsolated).toBe(true);
    for (const timing of report.timings) {
      expect(timing.runsMs).toHaveLength(request.runs);
      expect(timing.outputShape).toEqual([1, 5, timing.side, timing.side]);
    }
    reports.set(threads, report);
  });
}

test("the network alone, without post-processing, runs a tile within the budget at the app's thread count", () => {
  const report = reports.get(appThreads);
  test.skip(report === undefined, "the app's thread count did not run");
  const tile = report?.timings.find((timing) => timing.side === tileAtModelScale);
  expect(median(tile?.runsMs.slice(1) ?? [])).toBeLessThan(tileBudgetMs);
});
