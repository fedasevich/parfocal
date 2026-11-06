import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { samVariant } from "../src/index.ts";
import { benchOriginVariable, fixturesDir, missingGraphs } from "./global-setup.ts";
import type { Protocol, SmokeReport, SmokeRequest } from "./page/smart-select-accuracy-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/smart-select-accuracy", import.meta.url));

const baseline: Readonly<Record<Protocol, number>> = {
  ideal: 0.851,
  realistic: 0.851,
  box: 0.863,
  three: 0.884,
};

const protocols = Object.keys(baseline) as Protocol[];

const providers = ["webgpu", "wasm"] as const;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardError(values: readonly number[]): number {
  const centre = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - centre) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance / values.length);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

for (const provider of providers) {
  test(`smart select on TNBC patches meets the POC baseline on ${provider}`, async ({ page }) => {
    const variant = samVariant(provider);
    const missing = missingGraphs([variant.encoder, variant.decoder]);
    test.skip(missing.length > 0, `models not exported: ${missing.join(", ")}`);
    test.skip(
      !existsSync(join(fixturesDir(), "manifest.json")),
      "run pnpm --filter @parfocal/ml smoke:fixture first",
    );
    const origin = process.env[benchOriginVariable];
    if (!origin)
      throw new Error("Run the smoke test through playwright test -c playwright.sam.config.ts");

    await page.goto(`${origin}/app/smart-select-accuracy.html`);
    await page.waitForFunction(() => window.smartSmoke !== undefined);
    const request: SmokeRequest = {
      provider,
      modelsUrl: `${origin}/models`,
      fixturesUrl: `${origin}/fixtures`,
    };
    const report: SmokeReport = await page.evaluate((r) => window.smartSmoke.run(r), request);

    mkdirSync(reportDir, { recursive: true });
    writeFileSync(`${reportDir}/${provider}.json`, `${JSON.stringify(report, null, 2)}\n`);

    const summary = Object.fromEntries(
      protocols.map((protocol) => {
        const values = report.scores.map((score) => score.iou[protocol]);
        return [
          protocol,
          {
            mean: Number(mean(values).toFixed(3)),
            standardError: Number(standardError(values).toFixed(3)),
            atLeast075: Number((values.filter((v) => v >= 0.75).length / values.length).toFixed(3)),
          },
        ];
      }),
    );
    console.log(
      JSON.stringify({
        provider,
        adapter: report.adapter,
        encoder: report.encoderGraph,
        patches: report.patches,
        nuclei: report.nuclei,
        medianEncodeMs: Math.round(median(report.encodeMs)),
        medianDecodeMs: Math.round(median(report.decodeMs)),
        summary,
      }),
    );

    expect(report.crossOriginIsolated).toBe(true);
    if (provider === "webgpu") expect(report.adapter).not.toBeNull();
    expect(report.nuclei).toBeGreaterThanOrEqual(60);
    for (const protocol of protocols) {
      const values = report.scores.map((score) => score.iou[protocol]);
      const tolerance = 2 * standardError(values);
      expect(
        mean(values),
        `${protocol} mean IoU against the POC baseline ${baseline[protocol]} minus two standard errors`,
      ).toBeGreaterThanOrEqual(baseline[protocol] - tolerance);
    }
  });
}
