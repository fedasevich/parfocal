import { expect, type Page, test } from "@playwright/test";
import { compareFrames, type Frame } from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";
import type { PrepareMode, PrepareReport } from "./page/overlay-worker-harness.ts";

const polygons = 1_000_000;
const longTaskBoundMs = 50;

async function measure(
  page: Page,
  mode: PrepareMode,
): Promise<{ report: PrepareReport; frame: Frame }> {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.goto(harnessUrl("/app/overlay-worker.html"));
  await page.waitForFunction(() => window.workerHarness !== undefined);
  await assertSwiftShader(page);
  const report = await page.evaluate(({ count, route }) => window.workerHarness.run(count, route), {
    count: polygons,
    route: mode,
  });
  const frame = await captureScreenshot(page.locator("#scene"));
  return { report, frame };
}

test("a 1M polygon batch prepared in a worker never holds the page for 50 ms and draws the same", async ({
  page,
}, testInfo) => {
  test.setTimeout(480_000);
  const inPlace = await measure(page, "main");
  const offThread = await measure(page, "worker");
  const comparison = compareFrames(inPlace.frame, offThread.frame, {
    maxChannelDelta: 0,
    maxDifferingFraction: 1,
    maxMeanChannelError: 255,
  });
  const summary = {
    polygons,
    main: inPlace.report,
    worker: offThread.report,
    differingFraction: comparison.differingFraction,
    maxDelta: comparison.maxDelta,
  };
  console.log(JSON.stringify(summary));
  await testInfo.attach("worker.json", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });
  expect(inPlace.report.longestTaskMs).toBeGreaterThan(longTaskBoundMs);
  expect(offThread.report.triangles).toBe(inPlace.report.triangles);
  expect(comparison.differingFraction).toBe(0);
  expect(comparison.maxDelta).toEqual([0, 0, 0]);
  expect(offThread.report.longestTaskMs).toBeLessThan(longTaskBoundMs);
  expect(offThread.report.longTaskEntries).toBe(0);
});
