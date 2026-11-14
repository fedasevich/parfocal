import { fileURLToPath } from "node:url";
import {
  cameraBounds,
  fitCamera,
  PRIMARY_RENDERER_ROUTE,
  RENDERER_ROUTE_IDS,
  type RendererRouteId,
  tissueArea,
  zoomForMagnification,
} from "@parfocal/viewer-engine";
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
  skipUnlessCached,
  startVivHarness,
  vivHarnessRoutes,
} from "./viv-harness.ts";
import {
  cmu1MicronsPerPixel,
  cmu1TissueBox,
  cmu1TissueCentre,
  VIV_SCENES,
  VIV_TISSUE_SCENE,
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

function goldenOutcome(frame: Frame, scene: VivGoldenScene, outputDirectory: string): string {
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

const routeTasks: Record<RendererRouteId, string> = {
  viv: "the primary route",
  "deck-webgpu": "VIEW-037 (the deck.gl 9.4 WebGPU route) registers it",
  "custom-webgpu": "VIEW-038 (the custom WebGPU engine route) registers it",
};

for (const route of RENDERER_ROUTE_IDS) {
  for (const scene of VIV_SCENES) {
    const title =
      route === PRIMARY_RENDERER_ROUTE
        ? `${scene.name} matches its golden image`
        : `${scene.name} matches its golden image on the ${route} route`;
    test(title, async ({ page }, testInfo) => {
      const registered = await vivHarnessRoutes(page);
      test.skip(
        !registered.includes(route),
        `The ${route} route is not registered yet, ${routeTasks[route]}`,
      );
      const { result, frame } = await renderVivFrame(page, scene, "none", { route });
      expect(result.errors).toEqual([]);
      expect(result.route).toBe(route);
      if (route === PRIMARY_RENDERER_ROUTE) {
        expect(result.decoded?.workers).toBe(6);
        expect(result.decoded?.dispatched).toBeGreaterThan(0);
      }
      const outcome = checkGolden(frame, {
        name: scene.name,
        format: scene.format,
        goldenDirectory,
        outputDirectory: testInfo.outputDir,
      });
      if (outcome.status === "mismatched") throw new Error(outcome.message);
    });
  }
}

test("switching through every registered route and back keeps the camera and the 10x golden", async ({
  page,
}, testInfo) => {
  const scene = VIV_SCENES.find((candidate) => candidate.name.endsWith("-10x"));
  if (scene === undefined) throw new Error("No 10x scene is defined");
  const registered = await vivHarnessRoutes(page);
  expect(registered).toContain(PRIMARY_RENDERER_ROUTE);
  const switches = [
    ...registered.filter((route) => route !== PRIMARY_RENDERER_ROUTE),
    PRIMARY_RENDERER_ROUTE,
  ];
  const plain = await renderVivFrame(page, scene);
  const { result, frame } = await renderVivFrame(page, scene, "none", { switches });
  expect(result.errors).toEqual([]);
  expect(result.route).toBe(PRIMARY_RENDERER_ROUTE);
  expect(result.camera).toEqual(plain.result.camera);
  expect(result.decoded?.dispatched).toBeGreaterThan(0);
  expect(goldenOutcome(frame, scene, testInfo.outputDir)).toBe("matched");
});

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
    expect(goldenOutcome(frame, scene, testInfo.outputDir), scene.name).toBe("mismatched");
  }
});

test("every decode worker finds that CMU-1.svs decodes wrong natively and falls back, so the goldens hold", async ({
  page,
}, testInfo) => {
  const scene = VIV_SCENES[0];
  if (scene === undefined) throw new Error("No Viv scenes are defined");
  const { result, frame } = await renderVivFrame(page, scene);
  expect(result.errors).toEqual([]);
  expect(result.jpeg).toHaveLength(6);
  for (const report of result.jpeg) {
    expect(report?.jpeg).toBe("script");
    expect(report?.reason).toBe("disagreed");
    expect(report?.meanAbsoluteError ?? 0).toBeGreaterThan(40);
  }
  expect(goldenOutcome(frame, scene, testInfo.outputDir)).toBe("matched");
});

test("a route that trusts the native decoder on CMU-1.svs fails every golden", async ({
  page,
}, testInfo) => {
  for (const scene of VIV_SCENES) {
    const { result, frame } = await renderVivFrame(page, scene, "native-unvalidated");
    expect(
      result.jpeg.every((report) => report?.reason === "unvalidated"),
      scene.name,
    ).toBe(true);
    expect(goldenOutcome(frame, scene, testInfo.outputDir), scene.name).toBe("mismatched");
  }
});

test("CMU-1.tiff, stored as YCbCr JPEG, draws the colours of the CMU-1.svs golden", async ({
  page,
}) => {
  skipUnlessCached("CMU-1.tiff");
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
  expect(result.jpeg).toHaveLength(6);
  for (const report of result.jpeg) expect(report?.jpeg).toBe("native");
  const golden = readPng(goldenPath(goldenDirectory, scene.name));
  const comparison = compareFrames(frame, golden, toleranceFor(scene.format));
  expect(comparison.channelHint).toBeNull();
  for (const error of comparison.meanError) expect(error).toBeLessThan(sameSlideMeanError);
});

test("a route that reads the 4x level as 2x fails the 10x golden", async ({ page }, testInfo) => {
  const scene = VIV_SCENES.find((candidate) => candidate.name.endsWith("-10x"));
  if (scene === undefined) throw new Error("No 10x scene is defined");
  const { frame } = await renderVivFrame(page, scene, "wrong-level");
  expect(["mismatched", "empty"]).toContain(goldenOutcome(frame, scene, testInfo.outputDir));
});

test("CMU-1.svs opens fitted to a tissue box with a margin on every edge", async ({
  page,
}, testInfo) => {
  const fitScene = VIV_SCENES[0];
  if (fitScene === undefined) throw new Error("No Viv scenes are defined");
  const whole = await renderVivFrame(page, fitScene);
  const tissue = await renderVivFrame(page, VIV_TISSUE_SCENE);
  expect(tissue.result.errors).toEqual([]);
  const viewport = { width: 800, height: 600 };
  const extent = tissue.result.slide;
  const expected = fitCamera(
    extent,
    viewport,
    cameraBounds({ slide: extent, viewport, devicePixelRatio: 1 }),
    cmu1TissueBox,
  );
  expect(tissue.result.camera.x).toBeCloseTo(expected.x, 6);
  expect(tissue.result.camera.y).toBeCloseTo(expected.y, 6);
  expect(tissue.result.camera.zoom).toBeCloseTo(expected.zoom, 9);
  expect(tissue.result.camera.zoom).toBeGreaterThan(whole.result.camera.zoom);
  expect(tissueArea(cmu1TissueBox, extent)).not.toBeNull();
  const outcome = checkGolden(tissue.frame, {
    name: VIV_TISSUE_SCENE.name,
    format: VIV_TISSUE_SCENE.format,
    goldenDirectory,
    outputDirectory: testInfo.outputDir,
  });
  if (outcome.status === "mismatched") throw new Error(outcome.message);
  const wholeGolden = readPng(goldenPath(goldenDirectory, fitScene.name));
  const apart = compareFrames(tissue.frame, wholeGolden, toleranceFor(fitScene.format));
  expect(apart.pass).toBe(false);
});
