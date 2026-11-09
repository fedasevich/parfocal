import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { checkGolden, type Frame } from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureWebglCanvas } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";

const goldenDirectory = fileURLToPath(new URL("../../golden-images/goldens", import.meta.url));

function pixel(frame: Frame, x: number, y: number): number[] {
  const at = (y * frame.width + x) * 4;
  return [...frame.data.subarray(at, at + 4)];
}

test("a polygon with a hole and an island inside the hole matches its golden image", async ({
  page,
}, testInfo) => {
  await page.goto(harnessUrl("/app/overlay-holes.html"));
  await page.waitForFunction(() => window.holesHarness !== undefined);
  await assertSwiftShader(page);
  const report = await page.evaluate(() => window.holesHarness.render());
  expect(report.triangles).toBe(10);
  let frame = await captureWebglCanvas(page, "#scene");
  await expect
    .poll(async () => {
      frame = await captureWebglCanvas(page, "#scene");
      return frame.width > 0 && frame.data.length === frame.width * frame.height * 4;
    })
    .toBe(true);
  const middle = frame.width / 2;
  const hollow = pixel(frame, Math.round(middle * 0.7), middle);
  expect(hollow[3]).toBe(0);
  const filled = pixel(frame, Math.round(middle * 0.4), middle);
  expect(filled[3]).toBeGreaterThan(0);
  const islandPixel = pixel(frame, middle, middle);
  expect(islandPixel[3]).toBeGreaterThan(0);
  const outcome = checkGolden(frame, {
    name: "overlay-polygon-hole-island",
    format: "synthetic",
    goldenDirectory,
    outputDirectory: testInfo.outputDir,
    content: { minDistinctColours: 4, maxDominantColourFraction: 0.9, minLumaStdDev: 2 },
  });
  if (outcome.status === "mismatched") throw new Error(outcome.message);
});
