import { expect, type Page, test } from "@playwright/test";
import { compareFrames, type Frame } from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";
import type { IndicesReport, TriangulationMode } from "./page/overlay-indices-harness.ts";

const sizes = [20_000, 100_000, 1_000_000];
const repeatsFor = (polygons: number): number => (polygons >= 1_000_000 ? 3 : 5);

async function measure(
  page: Page,
  polygons: number,
  mode: TriangulationMode,
): Promise<{ report: IndicesReport; frame: Frame }> {
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.goto(harnessUrl("/app/overlay-indices.html"));
  await page.waitForFunction(() => window.indicesHarness !== undefined);
  await assertSwiftShader(page);
  const report = await page.evaluate(
    ({ count, triangulation }) => window.indicesHarness.run(count, triangulation),
    { count: polygons, triangulation: mode },
  );
  const frame = await captureScreenshot(page.locator("#scene"));
  return { report, frame };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

for (const polygons of sizes) {
  test(`precomputed triangle indices draw like deck's own triangulation for ${polygons} polygons`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(480_000);
    const repeats = repeatsFor(polygons);
    const updates: Record<TriangulationMode, number[]> = { precomputed: [], deck: [] };
    const frames: Record<TriangulationMode, number[]> = { precomputed: [], deck: [] };
    const batches: number[] = [];
    let precomputedFrame: Frame | null = null;
    let deckFrame: Frame | null = null;
    for (let run = 0; run < repeats; run++) {
      for (const mode of ["precomputed", "deck"] as const) {
        const { report, frame } = await measure(page, polygons, mode);
        updates[mode].push(report.updateMs);
        frames[mode].push(report.frameMs);
        if (mode === "precomputed") batches.push(report.batchMs);
        if (mode === "precomputed") precomputedFrame = frame;
        else deckFrame = frame;
      }
    }
    if (precomputedFrame === null || deckFrame === null) throw new Error("No frames were taken");
    const comparison = compareFrames(precomputedFrame, deckFrame, {
      maxChannelDelta: 0,
      maxDifferingFraction: 1,
      maxMeanChannelError: 255,
    });
    const summary = {
      polygons,
      repeats,
      batchMs: batches.map((value) => Math.round(value)),
      precomputedUpdateMs: updates.precomputed.map((value) => Math.round(value)),
      deckUpdateMs: updates.deck.map((value) => Math.round(value)),
      precomputedFrameMs: frames.precomputed.map((value) => Math.round(value)),
      deckFrameMs: frames.deck.map((value) => Math.round(value)),
      medianBatchMs: Math.round(median(batches)),
      medianPrecomputedUpdateMs: Math.round(median(updates.precomputed)),
      medianDeckUpdateMs: Math.round(median(updates.deck)),
      differingFraction: comparison.differingFraction,
      maxDelta: comparison.maxDelta,
      meanError: comparison.meanError,
    };
    console.log(JSON.stringify(summary));
    await testInfo.attach("indices.json", {
      body: JSON.stringify(summary, null, 2),
      contentType: "application/json",
    });
    expect(comparison.differingFraction).toBeLessThan(0.001);
    if (polygons >= 1_000_000) {
      expect(median(updates.precomputed)).toBeLessThan(median(updates.deck));
    }
  });
}
