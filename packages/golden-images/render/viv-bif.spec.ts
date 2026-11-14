import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { referenceTilesDir } from "@parfocal/test-fixtures";
import type { SlideIndex } from "@parfocal/viewer-engine";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import {
  checkGolden,
  compareFrames,
  contentProblems,
  goldenPath,
  readPng,
  toleranceFor,
} from "../src/index.ts";
import { assertSwiftShader } from "../src/playwright.ts";
import { openHarness, renderVivFrame, skipUnlessCached, startVivHarness } from "./viv-harness.ts";
import type { VivGoldenScene } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

const fixture = "OS-1.bif";

const openSlideSize = { width: 105_813, height: 93_951 };

const frameCornerInTissue = { x: 53_761, y: 63_813 };

const sidecar = JSON.parse(
  readFileSync(join(referenceTilesDir, fixture, "tile-index.json"), "utf8"),
) as SlideIndex;

const scenes: readonly VivGoldenScene[] = [
  {
    name: "viv-os-1-bif-fit",
    fixture,
    formatId: "ventana-bif",
    format: "bif",
    view: { kind: "fit" },
    index: sidecar,
  },
  {
    name: "viv-os-1-bif-frame-corner-40x",
    fixture,
    formatId: "ventana-bif",
    format: "bif",
    view: { kind: "magnification", magnification: 40, ...frameCornerInTissue },
    index: sidecar,
  },
];

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

for (const scene of scenes) {
  test(`${scene.name} matches its golden image`, async ({ page }, testInfo) => {
    skipUnlessCached(scene.fixture);
    const { result, frame } = await renderVivFrame(page, scene);
    expect(result.errors).toEqual([]);
    expect(result.decoded?.dispatched).toBeGreaterThan(0);
    expect(result.slide.width).toBe(openSlideSize.width);
    expect(result.slide.height).toBe(openSlideSize.height);
    const outcome = checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });

  test(`${scene.name} drawn as an unstitched frame grid fails its golden image`, async ({
    page,
  }) => {
    skipUnlessCached(scene.fixture);
    const unstitched = { ...scene, index: { ...sidecar, stitching: null } };
    const { result, frame } = await renderVivFrame(page, unstitched);
    expect(result.errors).toEqual([]);
    expect(contentProblems(frame)).toEqual([]);
    const golden = readPng(goldenPath(goldenDirectory, scene.name));
    expect(compareFrames(frame, golden, toleranceFor(scene.format)).pass).toBe(false);
  });
}
