import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { checkGolden, type Frame } from "../../golden-images/src/index.ts";
import { assertSwiftShader, captureWebglCanvas } from "../../golden-images/src/playwright.ts";
import { type AgreementKind, agreementKinds, comparisonKinds } from "../src/index.ts";
import { harnessUrl } from "./cdp.ts";

const goldenDirectory = fileURLToPath(new URL("../../golden-images/goldens", import.meta.url));

type Scene = Parameters<typeof window.agreementHarness.render>[0];

async function open(page: Page) {
  await page.goto(harnessUrl("/app/overlay-agreement.html"));
  await page.waitForFunction(() => window.agreementHarness !== undefined);
  await assertSwiftShader(page);
}

async function capture(page: Page, scene: Scene): Promise<Frame> {
  await page.evaluate((next) => window.agreementHarness.render(next), scene);
  return captureWebglCanvas(page, "#scene");
}

function inked(frame: Frame): number {
  let count = 0;
  for (let at = 3; at < frame.data.length; at += 4) if ((frame.data[at] ?? 0) > 0) count++;
  return count;
}

function distance(first: Frame, second: Frame): number {
  let total = 0;
  for (let at = 0; at < first.data.length; at++) {
    total += Math.abs((first.data[at] ?? 0) - (second.data[at] ?? 0));
  }
  return total;
}

for (const comparison of comparisonKinds) {
  test(`${comparison} matches its golden image`, async ({ page }, testInfo) => {
    await open(page);
    const frame = await capture(page, { comparison });
    expect(inked(frame)).toBeGreaterThan(500);
    const outcome = checkGolden(frame, {
      name: `overlay-agreement-${comparison}`,
      format: "synthetic",
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
      content: { minDistinctColours: 6, maxDominantColourFraction: 0.97, minLumaStdDev: 1 },
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

test("each agreement kind differs from the others with every colour made grey", async ({
  page,
}) => {
  await open(page);
  const frames = new Map<AgreementKind, Frame>();
  for (const only of agreementKinds) {
    frames.set(only, await capture(page, { comparison: "ai-vs-reviewed", only, mono: true }));
  }
  const solid = frames.get("both") as Frame;
  const dashed = frames.get("only-a") as Frame;
  const double = frames.get("only-b") as Frame;
  expect(inked(double)).toBeGreaterThan(0);
  expect(distance(solid, dashed)).toBeGreaterThan(0);
  expect(distance(solid, double)).toBeGreaterThan(0);
  expect(distance(dashed, double)).toBeGreaterThan(0);
});

test("a double outline has a dark line between two lighter bands", async ({ page }) => {
  await open(page);
  const frame = await capture(page, { comparison: "ai-vs-reviewed", only: "only-b", mono: true });
  const row = Math.round(88 * 2);
  const left = Math.round(10 * 2);
  const pixel = (column: number) => (row * frame.width + column) * 4;
  const solid: number[] = [];
  for (let column = left - 8; column < left + 8; column++) {
    if ((frame.data[pixel(column) + 3] ?? 0) > 200) solid.push(frame.data[pixel(column)] ?? 0);
  }
  const darkest = Math.min(...solid);
  const darkAt = solid.indexOf(darkest);
  expect(Math.max(...solid) - darkest).toBeGreaterThan(60);
  expect(darkAt).toBeGreaterThan(0);
  expect(darkAt).toBeLessThan(solid.length - 1);
});
