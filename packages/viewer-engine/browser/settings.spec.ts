import { expect, type Page, test } from "@playwright/test";
import {
  compareFrames,
  contentProblems,
  type Frame,
  type Tolerance,
} from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../../golden-images/src/playwright.ts";
import { collectGarbage, harnessUrl, liveObjects } from "./cdp.ts";
import type { ChannelScene, SceneReport, SettingsHarness } from "./page/settings-harness.ts";

async function openSettings(page: Page, uint8: SettingsHarness["uint8"]): Promise<void> {
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertSwiftShader(page);
  await page.goto(harnessUrl(`/app/settings.html?uint8=${uint8}`));
  await page.waitForFunction(() => window.settingsHarness !== undefined);
}

async function render(
  page: Page,
  uint8: SettingsHarness["uint8"],
  scene: ChannelScene,
): Promise<{ report: SceneReport; frame: Frame }> {
  await openSettings(page, uint8);
  const report = await page.evaluate((next) => window.settingsHarness.renderChannels(next), scene);
  const frame = await captureScreenshot(page.locator("#scene"));
  return { report, frame };
}

const oneLevel: Tolerance = { maxChannelDelta: 1, maxDifferingFraction: 0, maxMeanChannelError: 1 };

for (const interpolation of ["nearest", "linear"] as const) {
  test(`uint8 channels upload as r8unorm and draw like Viv's own textures with ${interpolation} filtering`, async ({
    page,
  }) => {
    const stock = await render(page, "stock", { interpolation });
    const compact = await render(page, "r8unorm", { interpolation });
    expect(contentProblems(compact.frame)).toEqual([]);
    expect(new Set(stock.report.textureFormats)).toEqual(
      new Set([interpolation === "linear" ? "r32float" : "r8uint"]),
    );
    expect(new Set(compact.report.textureFormats)).toEqual(new Set(["r8unorm"]));
    const comparison = compareFrames(compact.frame, stock.frame, oneLevel);
    console.log(
      `${interpolation}: max delta ${comparison.maxDelta.join("/")}, mean ${comparison.meanError.map((value) => value.toFixed(4)).join("/")}, differing ${comparison.differingPixels}`,
    );
    expect(comparison.failures).toEqual([]);
  });
}

test("the Viv canvas has no multisampling", async ({ page }) => {
  const { report } = await render(page, "r8unorm", { interpolation: "nearest" });
  expect(report.antialias).toBe(false);
  expect(report.samples).toBe(0);
});

for (const mode of ["wrapper", "finalize"] as const) {
  test(`a deck disposed before its device exists ${mode === "wrapper" ? "leaves no canvas context" : "leaks its canvas context without the wrapper"}`, async ({
    page,
  }) => {
    await openSettings(page, "r8unorm");
    await page.evaluate((next) => window.settingsHarness.disposeBeforeDevice(next), mode);
    const cdp = await page.context().newCDPSession(page);
    await collectGarbage(cdp);
    const decks = await liveObjects(cdp, "window.settingsHarness.prototypes.deck");
    const canvasContexts = await liveObjects(
      cdp,
      "window.settingsHarness.prototypes.canvasContext",
    );
    await cdp.detach();
    const leaked = mode === "wrapper" ? 0 : 1;
    expect({ decks, canvasContexts }).toEqual({ decks: leaked, canvasContexts: leaked });
  });
}
