import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { checkGolden, type Frame } from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureWebglCanvas } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";

const goldenDirectory = fileURLToPath(new URL("../../golden-images/goldens", import.meta.url));

type Change = Parameters<typeof window.drawStyleHarness.render>[0];

async function open(page: Page) {
  await page.goto(harnessUrl("/app/overlay-draw-style.html"));
  await page.waitForFunction(() => window.drawStyleHarness !== undefined);
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

const scenes: Array<{ name: string; change: Change; tint?: [number, number, number, number] }> = [
  { name: "outline-width-1", change: { draw: "outline", widthPx: 1, cutoff: 0 } },
  { name: "outline-width-2", change: { draw: "outline", widthPx: 2, cutoff: 0 } },
  { name: "outline-width-3", change: { draw: "outline", widthPx: 3, cutoff: 0 } },
  { name: "fill", change: { draw: "fill", widthPx: 2, cutoff: 0 } },
  { name: "dots", change: { draw: "dots", widthPx: 2, cutoff: 0 } },
  { name: "opacity-40", change: { draw: "outline", widthPx: 2, opacity: 40, cutoff: 0 } },
  { name: "colour-score", change: { colourBy: "score", cutoff: 0 } },
  { name: "colour-decision", change: { colourBy: "decision", cutoff: 0 } },
  { name: "cutoff-dimmed", change: { draw: "fill", cutoff: 0.5 } },
  {
    name: "current-tinted",
    change: { cutoff: 0 },
    tint: [248, 113, 113, 255],
  },
];

for (const scene of scenes) {
  test(`how objects draw: ${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    await open(page);
    await page.evaluate(
      ([change, tint]) => window.drawStyleHarness.render(change, tint ?? undefined),
      [scene.change, scene.tint ?? null] as const,
    );
    const frame = await captureWebglCanvas(page, "#scene");
    expect(inked(frame)).toBeGreaterThan(200);
    const outcome = checkGolden(frame, {
      name: `overlay-draw-${scene.name}`,
      format: "synthetic",
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
      content: { minDistinctColours: 3, maxDominantColourFraction: 0.97, minLumaStdDev: 1 },
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

type LiveChoices = Parameters<typeof window.drawStyleHarness.renderLive>[0];

const liveScenes: Array<{ name: string; choices: LiveChoices }> = [
  { name: "outline-width-1", choices: { draw: "outline", width: "1", cutoff: 0 } },
  { name: "outline-width-2", choices: { draw: "outline", width: "2", cutoff: 0 } },
  { name: "outline-width-3", choices: { draw: "outline", width: "3", cutoff: 0 } },
  { name: "fill", choices: { draw: "fill", width: "2", cutoff: 0 } },
  { name: "dots", choices: { draw: "dots", width: "2", cutoff: 0 } },
  { name: "opacity-40", choices: { draw: "outline", width: "2", opacity: 40, cutoff: 0 } },
  { name: "colour-score", choices: { colorBy: "score", cutoff: 0 } },
  { name: "colour-decision", choices: { colorBy: "decision", cutoff: 0 } },
  { name: "cutoff-dimmed", choices: { draw: "fill", cutoff: 0.5 } },
];

for (const scene of liveScenes) {
  test(`how objects draw live: ${scene.name} matches the still preview golden image`, async ({
    page,
  }, testInfo) => {
    await open(page);
    await page.evaluate((choices) => window.drawStyleHarness.renderLive(choices), scene.choices);
    const frame = await captureWebglCanvas(page, "#scene");
    expect(inked(frame)).toBeGreaterThan(200);
    const outcome = checkGolden(frame, {
      name: `overlay-draw-${scene.name}`,
      format: "synthetic",
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
      content: { minDistinctColours: 3, maxDominantColourFraction: 0.97, minLumaStdDev: 1 },
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

test("the styles differ from each other and the cutoff dims without removing objects", async ({
  page,
}) => {
  await open(page);
  const capture = async (change: Change) => {
    const report = await page.evaluate((c) => window.drawStyleHarness.render(c), change);
    return { report, frame: await captureWebglCanvas(page, "#scene") };
  };
  const thin = await capture({ widthPx: 1, cutoff: 0 });
  const thick = await capture({ widthPx: 3, cutoff: 0 });
  expect(inked(thick.frame)).toBeGreaterThan(inked(thin.frame));
  const outline = await capture({ draw: "outline", cutoff: 0 });
  const filled = await capture({ draw: "fill", cutoff: 0 });
  expect(inked(filled.frame)).toBeGreaterThan(inked(outline.frame) * 1.5);
  const full = await capture({ opacity: 100, cutoff: 0 });
  const faint = await capture({ opacity: 30, cutoff: 0 });
  expect(alphaSum(faint.frame)).toBeLessThan(alphaSum(full.frame) * 0.9);
  const kept = await capture({ cutoff: 0 });
  const dimmed = await capture({ cutoff: 0.5 });
  expect(dimmed.report.scope).toBe(kept.report.scope);
  expect(dimmed.report.dimmed).toBeGreaterThan(kept.report.dimmed);
  expect(alphaSum(dimmed.frame)).toBeLessThan(alphaSum(kept.frame));
  expect(inked(dimmed.frame)).toBeGreaterThan(inked(kept.frame) * 0.4);
});
