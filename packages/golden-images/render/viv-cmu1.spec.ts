import { fileURLToPath } from "node:url";
import { zoomForMagnification } from "@parfocal/viewer-engine";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import {
  checkGolden,
  compareFrames,
  contentProblems,
  EmptyFrameError,
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
import {
  cmu1MicronsPerPixel,
  cmu1TissueCentre,
  VIV_SCENES,
  type VivGoldenScene,
} from "./viv-scenes.ts";

const sameSlideMeanError = 10;

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const availability = fixtureAvailability("CMU-1.svs");

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  if (availability.status === "ready") server = await startVivHarness();
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

test.beforeEach(async ({ page }) => {
  test.skip(
    availability.status === "missing",
    availability.status === "missing" ? availability.message : "",
  );
  if (server === null) throw new Error("The Viv harness server did not start");
  await openHarness(page, server);
  await assertSwiftShader(page);
});

function goldenVerdict(frame: Frame, scene: VivGoldenScene, outputDirectory: string): string {
  try {
    return checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory,
      update: false,
    }).status;
  } catch (error) {
    if (error instanceof EmptyFrameError) return "empty";
    throw error;
  }
}

for (const scene of VIV_SCENES) {
  test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    const { result, frame } = await renderVivFrame(page, scene);
    expect(result.errors).toEqual([]);
    const outcome = checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

test("the route hands Viv a power-of-two ladder over the 1x, 4x and 16x levels of CMU-1.svs", async ({
  page,
}) => {
  const scene = VIV_SCENES[0];
  if (scene === undefined) throw new Error("No Viv scenes are defined");
  const { result } = await renderVivFrame(page, scene);
  expect(result.slide).toEqual({ width: 46_000, height: 32_914, micronsPerPixel: 0.499 });
  expect(result.ladder.map((level) => level.downsample)).toEqual([
    1, 2, 4, 8, 16, 32, 64, 128, 256,
  ]);
  expect(result.ladder.map((level) => level.backing)).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 2]);
});

test("a route that swaps red and blue fails every CMU-1.svs golden", async ({ page }) => {
  for (const scene of VIV_SCENES) {
    const { frame } = await renderVivFrame(page, scene, "swap-red-blue");
    expect(contentProblems(frame), scene.name).toEqual([]);
    const golden = readPng(goldenPath(goldenDirectory, scene.name));
    const comparison = compareFrames(frame, golden, toleranceFor(scene.format));
    expect(comparison.pass, scene.name).toBe(false);
    expect(comparison.channelHint, scene.name).toContain("BGR order");
  }
});

test("a route that hands Viv YCbCr samples as RGB fails every CMU-1.svs golden", async ({
  page,
}, testInfo) => {
  for (const scene of VIV_SCENES) {
    const { frame } = await renderVivFrame(page, scene, "ycbcr-as-rgb");
    expect(goldenVerdict(frame, scene, testInfo.outputDir), scene.name).toBe("mismatched");
  }
});

test("CMU-1.tiff, stored as YCbCr JPEG, draws the colours of the CMU-1.svs golden", async ({
  page,
}) => {
  const tiff = fixtureAvailability("CMU-1.tiff");
  test.skip(tiff.status === "missing", tiff.status === "missing" ? tiff.message : "");
  const scene = VIV_SCENES.find((candidate) => candidate.name.endsWith("-10x"));
  if (scene === undefined) throw new Error("No 10x scene is defined");
  const { result, frame } = await renderVivFrame(page, {
    ...scene,
    fixture: "CMU-1.tiff",
    formatId: "generic-tiff",
    view: {
      kind: "camera",
      ...cmu1TissueCentre,
      zoom: zoomForMagnification(cmu1MicronsPerPixel, 10),
    },
  });
  expect(result.errors).toEqual([]);
  const golden = readPng(goldenPath(goldenDirectory, scene.name));
  const comparison = compareFrames(frame, golden, toleranceFor(scene.format));
  expect(comparison.channelHint).toBeNull();
  for (const error of comparison.meanError) expect(error).toBeLessThan(sameSlideMeanError);
});

test("a route that reads the 4x level as 2x fails the 10x golden", async ({ page }, testInfo) => {
  const scene = VIV_SCENES.find((candidate) => candidate.name.endsWith("-10x"));
  if (scene === undefined) throw new Error("No 10x scene is defined");
  const { frame } = await renderVivFrame(page, scene, "wrong-level");
  expect(["mismatched", "empty"]).toContain(goldenVerdict(frame, scene, testInfo.outputDir));
});
