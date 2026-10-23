import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  CODEC_TOLERANCES,
  type Codec,
  checkGolden,
  compareFrames,
  contentProblems,
  EmptyFrameError,
  EXACT,
  goldenPath,
  readPng,
  toleranceFor,
} from "../src/index.ts";
import { assertSwiftShader, captureScreenshot, captureWebglCanvas } from "../src/playwright.ts";
import { renderScene, SCENES, tile } from "./scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertSwiftShader(page);
});

for (const scene of SCENES) {
  test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    const selector = await renderScene(page, scene);
    const frame = await captureWebglCanvas(page, selector);
    const outcome = checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") {
      throw new Error(outcome.message);
    }
  });
}

test("a 1:1 nearest render reproduces the source tile exactly", async ({ page }) => {
  const scene = SCENES[0];
  if (!scene) {
    throw new Error("No scenes are defined");
  }
  const frame = await captureWebglCanvas(page, await renderScene(page, scene));
  expect(compareFrames(frame, tile, EXACT).failures).toEqual([]);
});

test("an element screenshot agrees with readPixels", async ({ page }) => {
  for (const scene of SCENES) {
    const selector = await renderScene(page, scene);
    const pixels = await captureWebglCanvas(page, selector);
    const screenshot = await captureScreenshot(page.locator(selector));
    expect(compareFrames(screenshot, pixels, EXACT).failures, scene.name).toEqual([]);
  }
});

test("a renderer that swaps red and blue fails every format tolerance", async ({ page }) => {
  for (const scene of SCENES) {
    const golden = readPng(goldenPath(goldenDirectory, scene.name));
    const swapped = await captureWebglCanvas(
      page,
      await renderScene(page, scene, { channelOrder: "bgr" }),
    );
    expect(contentProblems(swapped)).toEqual([]);
    for (const codec of Object.keys(CODEC_TOLERANCES) as Codec[]) {
      const comparison = compareFrames(swapped, golden, CODEC_TOLERANCES[codec]);
      expect(comparison.pass, `${scene.name} under the ${codec} tolerance`).toBe(false);
      expect(comparison.channelHint, scene.name).toContain("BGR order");
    }
    expect(
      compareFrames(swapped, golden, toleranceFor(scene.format)).failures.length,
    ).toBeGreaterThan(0);
  }
});

test("a frame that never drew the tile is rejected as empty", async ({ page }) => {
  for (const scene of SCENES) {
    const empty = await captureWebglCanvas(
      page,
      await renderScene(page, scene, { drawTile: false }),
    );
    expect(contentProblems(empty).length, scene.name).toBeGreaterThan(0);
    expect(() =>
      checkGolden(empty, {
        name: scene.name,
        format: scene.format,
        goldenDirectory,
        outputDirectory: test.info().outputDir,
        update: false,
      }),
    ).toThrow(EmptyFrameError);
  }
});
