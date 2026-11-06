import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { samGraphs, samVariant } from "../src/index.ts";
import { benchOriginVariable, missingGraphs } from "./global-setup.ts";
import type { SamBenchReport, SamBenchRequest } from "./page/sam-variants-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/sam-bench", import.meta.url));
const aisDecoders = [
  samGraphs.aisDecoder,
  samGraphs.aisDecoderUint8,
  samGraphs.aisDecoderInt8Weights,
] as const;

const benches: readonly { name: string; request: Omit<SamBenchRequest, "modelsUrl"> }[] = [
  {
    name: "webgpu-q4",
    request: {
      provider: "webgpu",
      encoder: samVariant("webgpu").encoder,
      decoder: samVariant("webgpu").decoder,
      aisDecoders: [samGraphs.aisDecoder, samGraphs.aisDecoderInt8Weights],
      encodeRuns: 5,
      decodeRuns: 12,
      aisRuns: 5,
    },
  },
  {
    name: "wasm-uint8",
    request: {
      provider: "wasm",
      encoder: samVariant("wasm").encoder,
      decoder: samVariant("wasm").decoder,
      aisDecoders,
      encodeRuns: 5,
      decodeRuns: 12,
      aisRuns: 3,
    },
  },
];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

for (const bench of benches) {
  test(`PathoSAM ${bench.name} encodes, decodes clicks and decodes AIS maps`, async ({ page }) => {
    const graphs = [bench.request.encoder, bench.request.decoder, ...bench.request.aisDecoders];
    const missing = missingGraphs(graphs);
    test.skip(missing.length > 0, `models not exported: ${missing.join(", ")}`);
    const origin = process.env[benchOriginVariable];
    if (!origin)
      throw new Error("Run the bench through playwright test -c playwright.sam.config.ts");

    await page.goto(`${origin}/app/sam-variants.html`);
    await page.waitForFunction(() => window.samBench !== undefined);
    const request: SamBenchRequest = { ...bench.request, modelsUrl: `${origin}/models` };
    const report: SamBenchReport = await page.evaluate((r) => window.samBench.run(r), request);

    mkdirSync(reportDir, { recursive: true });
    writeFileSync(`${reportDir}/${bench.name}.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      JSON.stringify({
        bench: bench.name,
        adapter: report.adapter,
        threads: report.threads,
        steadyEncodeMs: Math.round(median(report.encodeMs.slice(2))),
        steadyDecodeMs: Math.round(median(report.decodeMs.slice(2))),
        ais: report.ais.map((ais) => ({
          graph: ais.graph,
          steadyMs: Math.round(median(ais.runsMs.slice(1))),
          maxAbsFromFp32: Number(ais.maxAbsFromFirst.toPrecision(3)),
          foregroundIou: Number(ais.foregroundIouWithFirst.toFixed(4)),
          foregroundShare: Number(ais.foregroundShare.toFixed(4)),
        })),
      }),
    );

    expect(report.crossOriginIsolated).toBe(true);
    if (bench.request.provider === "webgpu") expect(report.adapter).not.toBeNull();
    expect(report.encodeMs).toHaveLength(bench.request.encodeRuns);
    expect(report.decodeMs).toHaveLength(bench.request.decodeRuns);
    for (const timing of [...report.encodeMs, ...report.decodeMs]) {
      expect(timing).toBeGreaterThan(0);
    }
    expect(report.ais.map((ais) => ais.graph)).toEqual(bench.request.aisDecoders);
    for (const ais of report.ais) {
      expect(ais.outputDims).toEqual([1, 3, 512, 512]);
      expect(ais.maxAbsFromFirst).toBeLessThan(0.1);
    }
  });
}
