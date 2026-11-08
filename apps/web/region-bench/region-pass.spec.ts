import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { budget, exceeds } from "../../../scripts/perf-budgets.ts";
import { fixturesDir, missingGraphs, regionOriginVariable } from "./global-setup.ts";
import type { RegionReport, RegionRequest } from "./page/region-pass-harness.ts";

const reportDir = fileURLToPath(new URL("../test-results/region-pass", import.meta.url));

const graphs = [
  "pathosam.encoder_q4.onnx",
  "pathosam.encoder_uint8.onnx",
  "pathosam.decoder.onnx",
  "pathosam.ais_decoder_int8_weights.onnx",
];

test("a four tile auto region pass finishes under its budget on the real graphs", async ({
  page,
}) => {
  const missing = missingGraphs(graphs);
  test.skip(missing.length > 0, `models not exported: ${missing.join(", ")}`);
  test.skip(
    !existsSync(join(fixturesDir(), "manifest.json")),
    "run pnpm --filter @parfocal/ml smoke:fixture first",
  );
  const origin = process.env[regionOriginVariable];
  if (!origin) throw new Error("Run through playwright test -c playwright.region.config.ts");

  await page.goto(`${origin}/app/region-pass.html`);
  await page.waitForFunction(() => window.regionPass !== undefined);
  const request: RegionRequest = {
    modelsUrl: `${origin}/models`,
    fixturesUrl: `${origin}/fixtures`,
    passes: 3,
  };
  const report: RegionReport = await page.evaluate((r) => window.regionPass.run(r), request);

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify({
      provider: report.provider,
      fellBack: report.fellBack,
      tiles: report.tiles,
      passMs: report.passMs.map((ms) => Math.round(ms)),
      found: report.found,
      encodeMs: report.encodeMs.map((ms) => Math.round(ms)),
      aisMs: report.aisMs.map((ms) => Math.round(ms)),
    }),
  );

  expect(report.crossOriginIsolated).toBe(true);
  expect(report.tiles).toBe(4);
  expect(new Set(report.found).size).toBe(1);
  expect(report.found[0]).toBeGreaterThan(100);
  const warm = Math.min(...report.passMs.slice(1));
  expect(exceeds(await budget("aiseg.region-pass-ms"), warm)).toBeNull();
});
