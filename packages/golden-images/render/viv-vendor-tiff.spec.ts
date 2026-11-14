import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { checkGolden } from "../src/index.ts";
import { assertSwiftShader } from "../src/playwright.ts";
import { openHarness, renderVivFrame, skipUnlessCached, startVivHarness } from "./viv-harness.ts";
import type { VivGoldenScene } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

type Slide = Pick<VivGoldenScene, "fixture" | "formatId" | "format"> & {
  readonly name: string;
  readonly tissue: { readonly x: number; readonly y: number };
};

const slides: readonly Slide[] = [
  {
    name: "viv-philips-4-tiff",
    fixture: "Philips-4.tiff",
    formatId: "philips-tiff",
    format: "philips-tiff",
    tissue: { x: 15_360, y: 45_472 },
  },
  {
    name: "viv-huron-1-40x-tif",
    fixture: "Huron-1-40x.tif",
    formatId: "huron-tiff",
    format: "generic-tiff-jpeg",
    tissue: { x: 6_144, y: 13_984 },
  },
  {
    name: "viv-huron-1-uncompressed-tif",
    fixture: "Huron-1-Uncompressed.tif",
    formatId: "huron-tiff",
    format: "huron-uncompressed",
    tissue: { x: 3_072, y: 8_864 },
  },
  {
    name: "viv-argos-1-avs",
    fixture: "Argos-1.avs",
    formatId: "argos-avs",
    format: "generic-tiff-jpeg",
    tissue: { x: 84_000, y: 10_800 },
  },
];

const scenes: readonly VivGoldenScene[] = slides.flatMap(({ name, tissue, ...slide }) => [
  { ...slide, name: `${name}-fit`, view: { kind: "fit" } },
  { ...slide, name: `${name}-10x`, view: { kind: "magnification", magnification: 10, ...tissue } },
]);

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
    const outcome = checkGolden(frame, {
      name: scene.name,
      format: scene.format,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}
