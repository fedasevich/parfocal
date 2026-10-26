import { fileURLToPath } from "node:url";
import { zoomForMagnification } from "@parfocal/viewer-engine";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { checkGolden, compareFrames, goldenPath, readPng, toleranceFor } from "../src/index.ts";
import { assertSwiftShader } from "../src/playwright.ts";
import {
  fixtureAvailability,
  openHarness,
  renderVivFrame,
  startVivHarness,
} from "./viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre, type VivGoldenScene } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

const sameSlideMeanError = 10;

const cmu1Tiff10x: VivGoldenScene = {
  name: "viv-cmu-1-tiff-10x",
  fixture: "CMU-1.tiff",
  formatId: "generic-tiff",
  format: "generic-tiff-jpeg",
  view: {
    kind: "camera",
    ...cmu1TissueCentre,
    zoom: zoomForMagnification(cmu1MicronsPerPixel, 10),
  },
};

const syntheticFit: VivGoldenScene = {
  name: "viv-synthetic-jpeg-tiff-fit",
  fixture: "synthetic-jpeg.tiff",
  formatId: "generic-tiff",
  format: "generic-tiff-jpeg",
  view: { kind: "fit" },
};

const syntheticSparseFit: VivGoldenScene = {
  name: "viv-synthetic-sparse-tiff-fit",
  fixture: "synthetic-sparse.tiff",
  formatId: "generic-tiff",
  format: "generic-tiff-jpeg",
  view: { kind: "fit" },
};

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

for (const scene of [syntheticFit, syntheticSparseFit, cmu1Tiff10x]) {
  test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    if (scene.fixture === cmu1Tiff10x.fixture) {
      const availability = fixtureAvailability(scene.fixture);
      test.skip(
        availability.status === "missing",
        availability.status === "missing" ? availability.message : "",
      );
    }
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

test("CMU-1.tiff draws the same tissue as the CMU-1.svs golden at 10x", async ({ page }) => {
  const availability = fixtureAvailability(cmu1Tiff10x.fixture);
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
  const { frame } = await renderVivFrame(page, cmu1Tiff10x);
  const golden = readPng(goldenPath(goldenDirectory, "viv-cmu-1-svs-10x"));
  const comparison = compareFrames(frame, golden, toleranceFor("svs-jpeg"));
  expect(comparison.channelHint).toBeNull();
  for (const error of comparison.meanError) expect(error).toBeLessThan(sameSlideMeanError);
});

test("an absent tile draws as white glass and a damaged JPEG 2000 tile as grey", async ({
  page,
}) => {
  const sparse = await renderVivFrame(page, syntheticSparseFit);
  const damaged = await renderVivFrame(page, {
    ...syntheticSparseFit,
    fixture: "synthetic-jp2k-damaged.tiff",
    format: "svs-jp2k",
  });
  expect(sparse.result.errors).toEqual([]);
  expect(damaged.result.errors).toEqual([]);
  const at = (frame: typeof sparse.frame, x: number, y: number) => {
    const offset = (y * frame.width + x) * 4;
    return [frame.data[offset], frame.data[offset + 1], frame.data[offset + 2]];
  };
  const centreOfSecondTile = { x: 300, y: 100 };
  expect(at(sparse.frame, centreOfSecondTile.x, centreOfSecondTile.y)).toEqual([255, 255, 255]);
  expect(at(damaged.frame, centreOfSecondTile.x, centreOfSecondTile.y)).toEqual([160, 160, 160]);
});
