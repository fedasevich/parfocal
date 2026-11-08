import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { checkGolden, type Frame } from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureWebglCanvas } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";

const goldenDirectory = fileURLToPath(new URL("../../golden-images/goldens", import.meta.url));

type Scene = Parameters<typeof window.mapsHarness.render>[0];

async function open(page: Page) {
  await page.goto(harnessUrl("/app/overlay-maps.html"));
  await page.waitForFunction(() => window.mapsHarness !== undefined);
  await assertSwiftShader(page);
}

function inked(frame: Frame): number {
  let count = 0;
  for (let at = 3; at < frame.data.length; at += 4) if ((frame.data[at] ?? 0) > 0) count++;
  return count;
}

function alphaSum(frame: Frame): number {
  let sum = 0;
  for (let at = 3; at < frame.data.length; at += 4) sum += frame.data[at] ?? 0;
  return sum;
}

async function capture(page: Page, scene: Scene): Promise<Frame> {
  await page.evaluate((next) => window.mapsHarness.render(next), scene);
  return captureWebglCanvas(page, "#scene");
}

function check(frame: Frame, name: string, outputDirectory: string) {
  const outcome = checkGolden(frame, {
    name: `overlay-map-${name}`,
    format: "synthetic",
    goldenDirectory,
    outputDirectory,
    content: { minDistinctColours: 6, maxDominantColourFraction: 0.97, minLumaStdDev: 1 },
  });
  if (outcome.status === "mismatched") throw new Error(outcome.message);
}

const maps: Array<{ name: string; scene: Scene }> = [
  { name: "heatmap-viridis", scene: { map: "heatmap", colormap: "viridis" } },
  { name: "heatmap-inferno", scene: { map: "heatmap", colormap: "inferno" } },
  { name: "heatmap-turbo", scene: { map: "heatmap", colormap: "turbo" } },
  { name: "heatmap-threshold", scene: { map: "heatmap", threshold: 0.4 } },
  { name: "density", scene: { map: "density" } },
  { name: "density-threshold", scene: { map: "density", threshold: 0.4 } },
  { name: "confidence", scene: { map: "confidence" } },
  { name: "confidence-threshold", scene: { map: "confidence", threshold: 0.4 } },
];

for (const { name, scene } of maps) {
  test(`${name} matches its golden image`, async ({ page }, testInfo) => {
    await open(page);
    const frame = await capture(page, scene);
    expect(inked(frame)).toBeGreaterThan(200);
    check(frame, name, testInfo.outputDir);
  });
}

const steps = [20, 30, 40, 50, 60, 70, 80, 90, 100];

for (const strength of steps) {
  test(`heatmap strength ${strength} matches its golden image`, async ({ page }, testInfo) => {
    await open(page);
    const frame = await capture(page, { map: "heatmap", strength });
    expect(inked(frame)).toBeGreaterThan(200);
    check(frame, `heatmap-strength-${strength}`, testInfo.outputDir);
  });
}

test("heatmap strength off draws nothing", async ({ page }) => {
  await open(page);
  const frame = await capture(page, { map: "heatmap", strength: 0 });
  expect(inked(frame)).toBe(0);
});

test("a stronger heatmap draws more and a higher threshold hides cells", async ({ page }) => {
  await open(page);
  const weak = await capture(page, { map: "heatmap", strength: 20 });
  const mid = await capture(page, { map: "heatmap", strength: 60 });
  const full = await capture(page, { map: "heatmap", strength: 100 });
  expect(alphaSum(weak)).toBeLessThan(alphaSum(mid));
  expect(alphaSum(mid)).toBeLessThan(alphaSum(full));
  for (const map of ["heatmap", "density", "confidence"] as const) {
    const low = await capture(page, { map, threshold: 0.05 });
    const high = await capture(page, { map, threshold: 0.5 });
    expect(inked(high)).toBeLessThan(inked(low));
    expect(inked(high)).toBeGreaterThan(0);
  }
});
