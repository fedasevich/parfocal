import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import {
  checkGolden,
  compareFrames,
  type Frame,
  goldenPath,
  readPng,
  toleranceFor,
} from "../src/index.ts";
import { assertSwiftShader } from "../src/playwright.ts";
import {
  fixtureAvailability,
  openHarness,
  renderVivFrame,
  startVivHarness,
} from "./viv-harness.ts";
import { cmu1TissueCentre, type VivGoldenScene } from "./viv-scenes.ts";

const sameSlideMeanError = 10;

const damagedGrey = 160;

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

const cmu1Jp2k10x: VivGoldenScene = {
  name: "viv-cmu-1-jp2k-33005-svs-10x",
  fixture: "CMU-1-JP2K-33005.svs",
  formatId: "aperio-svs",
  format: "svs-jp2k",
  view: { kind: "magnification", magnification: 10, ...cmu1TissueCentre },
};

const aperio33003Fit: VivGoldenScene = {
  name: "viv-jp2k-33003-1-svs-fit",
  fixture: "JP2K-33003-1.svs",
  formatId: "aperio-svs",
  format: "svs-jp2k",
  view: { kind: "fit" },
};

const damagedFit: VivGoldenScene = {
  name: "viv-synthetic-jp2k-damaged-fit",
  fixture: "synthetic-jp2k-damaged.tiff",
  formatId: "generic-tiff",
  format: "svs-jp2k",
  view: { kind: "fit" },
};

const cachedScenes = [cmu1Jp2k10x, aperio33003Fit];

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  server = await startVivHarness();
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

test.beforeEach(async ({ page }) => {
  if (server === null) throw new Error("The Viv harness server did not start");
  await openHarness(page, server);
  await assertSwiftShader(page);
});

function skipUnlessCached(fixture: string): void {
  const availability = fixtureAvailability(fixture);
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
}

function greyShare(frame: Frame): number {
  let grey = 0;
  for (let at = 0; at < frame.width * frame.height; at++) {
    if (
      frame.data[at * 4] === damagedGrey &&
      frame.data[at * 4 + 1] === damagedGrey &&
      frame.data[at * 4 + 2] === damagedGrey
    ) {
      grey++;
    }
  }
  return grey / (frame.width * frame.height);
}

for (const scene of cachedScenes) {
  test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    skipUnlessCached(scene.fixture);
    const { result, frame } = await renderVivFrame(page, scene);
    expect(result.errors).toEqual([]);
    expect(result.decoded?.workers).toBe(6);
    expect(result.decoded?.dispatched).toBeGreaterThan(0);
    const outcome = checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

test("CMU-1-JP2K-33005.svs draws the colours of the CMU-1.svs golden at 10x", async ({ page }) => {
  skipUnlessCached(cmu1Jp2k10x.fixture);
  const { result, frame } = await renderVivFrame(page, cmu1Jp2k10x);
  expect(result.errors).toEqual([]);
  const golden = readPng(goldenPath(goldenDirectory, "viv-cmu-1-svs-10x"));
  const comparison = compareFrames(frame, golden, toleranceFor("svs-jpeg"));
  expect(comparison.channelHint).toBeNull();
  for (const error of comparison.meanError) expect(error).toBeLessThan(sameSlideMeanError);
});

test("a slide with two damaged JPEG 2000 tiles draws them grey and keeps the rest", async ({
  page,
}, testInfo) => {
  const { result, frame } = await renderVivFrame(page, damagedFit);
  expect(result.errors).toEqual([]);
  expect(result.decoded?.workers).toBe(6);
  const share = greyShare(frame);
  expect(share).toBeGreaterThan(0.1);
  expect(share).toBeLessThan(0.2);
  const outcome = checkGolden(frame, {
    name: damagedFit.name,
    format: damagedFit.format,
    goldenDirectory,
    outputDirectory: testInfo.outputDir,
  });
  if (outcome.status === "mismatched") throw new Error(outcome.message);
});

test("the intact copy of the damaged slide draws no grey", async ({ page }) => {
  const { result, frame } = await renderVivFrame(page, {
    ...damagedFit,
    fixture: "synthetic-jp2k-33005.tiff",
  });
  expect(result.errors).toEqual([]);
  expect(greyShare(frame)).toBeLessThan(0.01);
});
