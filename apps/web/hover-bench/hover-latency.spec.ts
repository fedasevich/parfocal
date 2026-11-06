import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { fixturesDir, hoverOriginVariable, missingGraphs } from "./global-setup.ts";
import type { LatencyReport, LatencyRequest } from "./page/hover-latency-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/hover-latency", import.meta.url));

const budgetMs = 100;

const graphs = ["pathosam.encoder_q4.onnx", "pathosam.encoder_uint8.onnx", "pathosam.decoder.onnx"];

function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return sorted[Math.max(0, at)] ?? Number.NaN;
}

function summary(values: readonly number[]) {
  return {
    n: values.length,
    min: Number(Math.min(...values).toFixed(1)),
    median: Number(quantile(values, 0.5).toFixed(1)),
    p95: Number(quantile(values, 0.95).toFixed(1)),
    max: Number(Math.max(...values).toFixed(1)),
  };
}

test("hover preview shows an outline under 100 ms from the pointer on the real graphs", async ({
  page,
}) => {
  const missing = missingGraphs(graphs);
  test.skip(missing.length > 0, `models not exported: ${missing.join(", ")}`);
  test.skip(
    !existsSync(join(fixturesDir(), "manifest.json")),
    "run pnpm --filter @parfocal/ml smoke:fixture first",
  );
  const origin = process.env[hoverOriginVariable];
  if (!origin) throw new Error("Run through playwright test -c playwright.hover.config.ts");

  await page.goto(`${origin}/app/hover-latency.html`);
  await page.waitForFunction(() => window.hoverLatency !== undefined);
  const request: LatencyRequest = {
    modelsUrl: `${origin}/models`,
    fixturesUrl: `${origin}/fixtures`,
    patches: 8,
  };
  const report: LatencyReport = await page.evaluate((r) => window.hoverLatency.run(r), request);

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  const digest = {
    provider: report.provider,
    adapter: report.adapter,
    patches: report.patches,
    outline: summary(report.outlineMs),
    outlineAndFrame: summary(report.frameMs),
    cached: summary(report.cachedMs),
    decode: summary(report.decodeMs),
    encode: summary(report.encodeMs),
    withoutOutline: report.withoutOutline,
    sweep: report.sweep,
  };
  console.log(JSON.stringify(digest));

  expect(report.crossOriginIsolated).toBe(true);
  expect(report.outlineMs.length).toBeGreaterThanOrEqual(60);
  expect(quantile(report.outlineMs, 0.5)).toBeLessThan(budgetMs);
  expect(quantile(report.outlineMs, 0.95)).toBeLessThan(budgetMs);
  expect(report.sweep.decodes).toBeGreaterThan(0);
  expect(report.sweep.decodes).toBeLessThan(report.sweep.moves);
});
