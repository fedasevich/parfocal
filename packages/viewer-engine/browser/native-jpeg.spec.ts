import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { fixtureAvailability } from "../../golden-images/render/viv-harness.ts";
import type { SlideFormatId } from "../src/index.ts";
import { nativeAgreementThreshold } from "../src/index.ts";
import { harnessUrl } from "./cdp.ts";
import type { NativeJpegMeasurement } from "./page/native-jpeg-harness.ts";

type Expectation = "native" | "script" | "none";

interface Candidate {
  readonly file: string;
  readonly formatId: SlideFormatId;
  readonly expected: Expectation;
}

const candidates: readonly Candidate[] = [
  { file: "CMU-1.svs", formatId: "aperio-svs", expected: "script" },
  { file: "CMU-2.svs", formatId: "aperio-svs", expected: "script" },
  { file: "CMU-1-Small-Region.svs", formatId: "aperio-svs", expected: "script" },
  { file: "Huron-1-40x.tif", formatId: "huron-tiff", expected: "script" },
  { file: "CMU-1.tiff", formatId: "generic-tiff", expected: "native" },
  { file: "Philips-3.tiff", formatId: "philips-tiff", expected: "native" },
  { file: "Philips-4.tiff", formatId: "philips-tiff", expected: "native" },
  { file: "Argos-1.avs", formatId: "argos-avs", expected: "native" },
  { file: "Leica-1.scn", formatId: "leica-scn", expected: "native" },
  { file: "test_001.tif", formatId: "generic-tiff", expected: "native" },
  { file: "tumor_009.tif", formatId: "generic-tiff", expected: "native" },
  { file: "Huron-1-Uncompressed.tif", formatId: "huron-tiff", expected: "none" },
];

const reportPath = join(
  fileURLToPath(new URL("../test-results/native-jpeg", import.meta.url)),
  "report.json",
);

const pocMiddleTileError = 47.69;

test.describe.configure({ mode: "serial", timeout: 240_000 });

const measurements: Record<string, NativeJpegMeasurement> = {};

test.afterAll(() => {
  mkdirSync(join(reportPath, ".."), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(measurements, null, 2));
});

async function openHarness(page: Page): Promise<void> {
  await page.goto(harnessUrl("/app/native-jpeg.html"));
  await page.waitForFunction(() => window.nativeJpegHarness !== undefined);
}

test("the middle tile of CMU-1.svs decodes natively with the POC's mean absolute error of 47.7", async ({
  page,
}) => {
  const availability = fixtureAvailability("CMU-1.svs");
  test.skip(availability.status === "missing", "fixture not downloaded");
  await openHarness(page);
  const error = await page.evaluate(
    (url) => window.nativeJpegHarness.middleTileError(url),
    harnessUrl("/cache/CMU-1.svs"),
  );
  expect(error).toBeGreaterThan(pocMiddleTileError - 0.05);
  expect(error).toBeLessThan(pocMiddleTileError + 0.05);
});

for (const candidate of candidates) {
  test(`${candidate.file} is validated and ${candidate.expected === "native" ? "decoded natively" : candidate.expected === "script" ? "falls back to the script decoder" : "has no JPEG tiles"}, in the page and in a decode worker`, async ({
    page,
  }) => {
    const availability = fixtureAvailability(candidate.file);
    test.skip(availability.status === "missing", "fixture not downloaded");
    await openHarness(page);
    const result = await page.evaluate(
      ({ url, formatId }) => window.nativeJpegHarness.measure(url, formatId),
      { url: harnessUrl(`/cache/${candidate.file}`), formatId: candidate.formatId },
    );
    measurements[candidate.file] = result;
    expect(result.workerHasCreateImageBitmap).toBe(true);
    expect(result.pageReport.jpeg).toBe(candidate.expected);
    expect(result.workerReport?.jpeg).toBe(candidate.expected);
    if (candidate.expected === "native") {
      expect(result.pageReport.reason).toBe("agreed");
      expect(result.pageReport.meanAbsoluteError ?? 99).toBeLessThanOrEqual(
        nativeAgreementThreshold,
      );
      expect(result.pageReport.nativeFallbacks).toBe(0);
      if (result.meanAbsoluteErrorOnWindow !== null) {
        expect(result.meanAbsoluteErrorOnWindow).toBeLessThanOrEqual(nativeAgreementThreshold);
        expect(result.nativeMs ?? Number.POSITIVE_INFINITY).toBeLessThan(result.scriptMs);
      }
    }
    if (candidate.expected === "script") {
      expect(result.pageReport.reason).toBe("disagreed");
      expect(result.pageReport.meanAbsoluteError ?? 0).toBeGreaterThan(nativeAgreementThreshold);
      expect(result.pageReport.nativeReads).toBe(0);
      expect(result.pageReport.scriptReads).toBeGreaterThan(0);
    }
    if (candidate.file.endsWith(".svs")) {
      expect(result.pageReport.meanAbsoluteError ?? 0).toBeGreaterThan(40);
    }
  });
}
