import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { graphRunsOn, samGraphs, samVariant } from "../src/index.ts";
import { benchOriginVariable, missingGraphs, parityDir } from "./global-setup.ts";
import { mean } from "./page/parity-measures.ts";
import type { ParityReport, ParityRequest } from "./page/sam-parity-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/sam-parity", import.meta.url));
const requireVariable = "PARFOCAL_REQUIRE_SAM_PARITY";
const providers = ["webgpu", "wasm"] as const;
const aisDecoders = [
  samGraphs.aisDecoder,
  samGraphs.aisDecoderInt8Weights,
  samGraphs.aisDecoderUint8,
] as const;

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

for (const provider of providers) {
  test(`PathoSAM browser graphs on ${provider} match PyTorch on the fixed TNBC patches`, async ({
    page,
  }) => {
    const variant = samVariant(provider);
    const ais = aisDecoders.filter((graph) => graphRunsOn(graph, provider));
    const missing = missingGraphs([variant.encoder, variant.decoder, ...ais]);
    const noFixture = !existsSync(join(parityDir(), "manifest.json"));
    const reason = noFixture
      ? "run pnpm --filter @parfocal/ml parity:fixture first"
      : `models not exported: ${missing.join(", ")}`;
    if (process.env[requireVariable] === "1") {
      expect(missing, reason).toEqual([]);
      expect(noFixture, reason).toBe(false);
    }
    test.skip(missing.length > 0 || noFixture, reason);
    const origin = process.env[benchOriginVariable];
    if (!origin)
      throw new Error("Run the parity test through playwright test -c playwright.sam.config.ts");

    await page.goto(`${origin}/app/sam-parity.html`);
    await page.waitForFunction(() => window.samParity !== undefined);
    const request: ParityRequest = {
      provider,
      modelsUrl: `${origin}/models`,
      fixturesUrl: `${origin}/parity`,
      encoder: variant.encoder,
      decoder: variant.decoder,
      aisDecoders: ais,
    };
    const report: ParityReport = await page.evaluate((r) => window.samParity.run(r), request);

    mkdirSync(reportDir, { recursive: true });
    writeFileSync(`${reportDir}/${provider}.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        provider,
        adapter: report.adapter,
        ort: report.ortVersion,
        encoder: report.encoder,
        patches: report.patches,
        clicks: report.clickIous.length,
        embeddingMaxAbs: round(Math.max(...report.embeddingMaxAbs), 3),
        clickMeanIou: round(mean(report.clickIous)),
        clickMinIou: round(Math.min(...report.clickIous)),
        exactClicks: report.clickIous.filter((value) => value === 1).length,
        medianEncodeMs: Math.round(median(report.encodeMs)),
        medianDecodeMs: Math.round(median(report.decodeMs)),
        ais: report.ais.map((entry) => ({
          graph: entry.graph,
          torchEmbeddings: {
            maxAbs: round(entry.fromTorchEmbeddings.maxAbs, 3),
            meanIou: round(mean(entry.fromTorchEmbeddings.foregroundIous)),
            minIou: round(Math.min(...entry.fromTorchEmbeddings.foregroundIous)),
          },
          browserEmbeddings: {
            maxAbs: round(entry.fromBrowserEmbeddings.maxAbs, 3),
            meanIou: round(mean(entry.fromBrowserEmbeddings.foregroundIous)),
            minIou: round(Math.min(...entry.fromBrowserEmbeddings.foregroundIous)),
          },
        })),
      }),
    );

    const { clickMeanIou, aisMeanForegroundIou } = report.manifest.thresholds;
    expect(report.crossOriginIsolated).toBe(true);
    if (provider === "webgpu") expect(report.adapter).not.toBeNull();
    expect(report.clickIous.length).toBeGreaterThanOrEqual(30);
    expect(mean(report.clickIous), "click mask IoU against PyTorch").toBeGreaterThanOrEqual(
      clickMeanIou,
    );
    expect(report.ais.map((entry) => entry.graph)).toEqual(ais);
    for (const entry of report.ais) {
      expect(
        mean(entry.fromTorchEmbeddings.foregroundIous),
        `${entry.graph} foreground IoU from PyTorch embeddings`,
      ).toBeGreaterThanOrEqual(aisMeanForegroundIou);
      expect(
        mean(entry.fromBrowserEmbeddings.foregroundIous),
        `${entry.graph} foreground IoU from ${report.encoder} embeddings`,
      ).toBeGreaterThanOrEqual(aisMeanForegroundIou);
    }
  });
}
