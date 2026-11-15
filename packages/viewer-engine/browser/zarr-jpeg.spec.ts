import { skipUnlessConverted } from "@parfocal/test-fixtures";
import { expect, test } from "@playwright/test";
import { nativeAgreementThreshold } from "../src/index.ts";
import { harnessUrl } from "./cdp.ts";

const stores: readonly (readonly [string, string, string | false])[] = [
  ["synthetic-jpeg.ome.zarr", "/synthetic/synthetic-jpeg.ome.zarr", false],
  ["synthetic-jpeg-sharded.ome.zarr", "/synthetic/synthetic-jpeg-sharded.ome.zarr", false],
  ["synthetic-jpeg-converted.ome.zarr", "/synthetic/synthetic-jpeg-converted.ome.zarr", false],
  [
    "CMU-1-Small-Region.ome.zarr",
    "/cache/converted/CMU-1-Small-Region.ome.zarr",
    skipUnlessConverted("CMU-1-Small-Region.ome.zarr"),
  ],
];

for (const [store, path, skip] of stores) {
  test(`${store} decodes its JPEG chunks natively, in the page and in a decode worker`, async ({
    page,
  }) => {
    test.skip(skip !== false, skip || "");
    await page.goto(harnessUrl("/app/native-jpeg.html"));
    await page.waitForFunction(() => window.nativeJpegHarness !== undefined);
    const result = await page.evaluate(
      (url) => window.nativeJpegHarness.measure(url, "ome-zarr"),
      harnessUrl(path),
    );
    expect(result.workerHasCreateImageBitmap).toBe(true);
    expect(result.pageReport.jpeg).toBe("native");
    expect(result.pageReport.reason).toBe("agreed");
    expect(result.pageReport.meanAbsoluteError ?? 99).toBeLessThanOrEqual(nativeAgreementThreshold);
    expect(result.pageReport.nativeReads).toBeGreaterThan(0);
    expect(result.pageReport.nativeFallbacks).toBe(0);
    expect(result.workerReport?.jpeg).toBe("native");
    expect(result.workerReport?.reason).toBe("agreed");
    expect(result.meanAbsoluteErrorOnWindow ?? 99).toBeLessThanOrEqual(nativeAgreementThreshold);
  });
}
