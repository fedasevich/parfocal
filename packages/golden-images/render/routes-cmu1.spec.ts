import { fileURLToPath } from "node:url";
import {
  type OverlayKind,
  overlayStack,
  PRIMARY_RENDERER_ROUTE,
  RENDERER_ROUTE_IDS,
  type RendererRouteId,
} from "@parfocal/viewer-engine";
import { expect, type Page, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import type { OverlayHarness, OverlayRenderResult } from "../harness/viv/overlay-protocol.ts";
import { overlayHarnessGlobal } from "../harness/viv/overlay-protocol.ts";
import {
  checkGolden,
  compareFrames,
  contentProblems,
  type Frame,
  goldenPath,
  readPng,
  type SlideFormat,
  type Tolerance,
} from "../src/index.ts";
import {
  assertSwiftShader,
  captureScreenshot,
  WEBGPU_SWIFTSHADER_ARGS,
} from "../src/playwright.ts";
import {
  fixtureAvailability,
  fixtureUrl,
  harnessUrl,
  openHarness,
  renderVivFrame,
  startVivHarness,
  vivHarnessRoutes,
} from "./viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre, VIV_SCENES } from "./viv-scenes.ts";

const overlayTolerance: Tolerance = {
  maxChannelDelta: 4,
  maxDifferingFraction: 0.001,
  maxMeanChannelError: 0.5,
};

const knownOverlayDifference: Partial<Record<OverlayKind, number>> = {
  nuclei: 0.01,
  "ai-proposals": 0.02,
  "human-annotations": 0.01,
  measurements: 0.01,
};

const platformGoldenKinds: ReadonlySet<OverlayKind> = new Set(["id-labels"]);

const dashedOutlinesMessage =
  "The deck.gl WebGPU route cannot draw every overlay style: dashed outlines are drawn solid";

const expectedOverlayErrors: Partial<Record<OverlayKind, readonly string[]>> = {
  "ai-proposals": [dashedOutlinesMessage],
};

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const availability = fixtureAvailability("CMU-1.svs");

test.use({ launchOptions: { args: WEBGPU_SWIFTSHADER_ARGS } });
test.describe.configure({ timeout: 180_000 });

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

const routeTasks: Record<RendererRouteId, string> = {
  viv: "the primary route",
  "deck-webgpu": "VIEW-037 (the deck.gl 9.4 WebGPU route) registers it",
  "custom-webgpu": "VIEW-038 (the custom WebGPU engine route) registers it",
};

const alternateRoutes = RENDERER_ROUTE_IDS.filter((route) => route !== PRIMARY_RENDERER_ROUTE);

function expectGolden(
  frame: Frame,
  name: string,
  format: SlideFormat,
  outputDirectory: string,
  tolerance?: Tolerance,
) {
  const outcome = checkGolden(frame, {
    name,
    format,
    ...(tolerance === undefined ? {} : { tolerance }),
    goldenDirectory,
    outputDirectory,
    update: false,
  });
  expect(outcome.status, outcome.status === "mismatched" ? outcome.message : name).toBe("matched");
}

async function skipUnlessRegistered(page: Page, route: RendererRouteId): Promise<void> {
  const registered = await vivHarnessRoutes(page);
  test.skip(
    !registered.includes(route),
    `The ${route} route is not registered yet, ${routeTasks[route]}`,
  );
}

async function renderOverlay(
  page: Page,
  server: ViteDevServer,
  kind: OverlayKind,
  route: RendererRouteId,
): Promise<{ readonly result: OverlayRenderResult; readonly frame: Frame }> {
  await page.goto(`${harnessUrl(server)}overlays.html`);
  await page.waitForFunction((name) => name in globalThis, overlayHarnessGlobal, {
    timeout: 60_000,
  });
  const result = await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, OverlayHarness>)[name];
      if (harness === undefined) throw new Error("The overlay harness did not load");
      return harness.render(scene);
    },
    {
      name: overlayHarnessGlobal,
      scene: {
        url: fixtureUrl("CMU-1.svs"),
        formatId: "aperio-svs" as const,
        layers: [kind],
        registration: "before-mount" as const,
        reverse: false,
        viewport: { width: 400, height: 300 },
        centre: cmu1TissueCentre,
        magnification: 10,
        micronsPerPixel: cmu1MicronsPerPixel,
        route,
      },
    },
  );
  return { result, frame: await captureScreenshot(page.locator("#viewer canvas")) };
}

test("the browser offers a WebGPU adapter on the harness origin", async ({ page }) => {
  const available = await page.evaluate(async () => {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return gpu === undefined
      ? "no navigator.gpu"
      : (await gpu.requestAdapter())
        ? "adapter"
        : "no adapter";
  });
  expect(available).toBe("adapter");
});

test("the Viv goldens still match when Chrome also offers a WebGPU adapter", async ({
  page,
}, testInfo) => {
  for (const scene of VIV_SCENES) {
    const { result, frame } = await renderVivFrame(page, scene);
    expect(result.errors, scene.name).toEqual([]);
    expect(result.route).toBe(PRIMARY_RENDERER_ROUTE);
    expectGolden(frame, scene.name, scene.format, testInfo.outputDir);
  }
});

for (const route of alternateRoutes) {
  for (const scene of VIV_SCENES) {
    test(`${scene.name} matches its golden image on the ${route} route`, async ({
      page,
    }, testInfo) => {
      await skipUnlessRegistered(page, route);
      const { result, frame } = await renderVivFrame(page, scene, "none", { route });
      expect(result.errors).toEqual([]);
      expect(result.route).toBe(route);
      expect(result.uncapturedGpuErrors).toBe(0);
      expect(result.decoded?.workers).toBe(6);
      expect(result.decoded?.dispatched).toBeGreaterThan(0);
      expectGolden(frame, scene.name, scene.format, testInfo.outputDir);
    });
  }

  for (const kind of overlayStack) {
    const allowed = knownOverlayDifference[kind];
    const reference = platformGoldenKinds.has(kind)
      ? "the Viv frame of the same browser"
      : "its Viv golden image";
    const title =
      allowed === undefined
        ? `the ${kind} layer matches ${reference} on the ${route} route`
        : `the ${kind} layer stays within ${allowed * 100}% of ${reference} on the ${route} route`;
    test(title, async ({ page }) => {
      await skipUnlessRegistered(page, route);
      if (server === null) throw new Error("The Viv harness server did not start");
      const { result, frame } = await renderOverlay(page, server, kind, route);
      expect(result.errors).toEqual(expectedOverlayErrors[kind] ?? []);
      expect(result.uncapturedGpuErrors).toBe(0);
      expect(result.layerIds).toEqual([kind]);
      expect(contentProblems(frame)).toEqual([]);
      const expected = platformGoldenKinds.has(kind)
        ? (await renderOverlay(page, server, kind, PRIMARY_RENDERER_ROUTE)).frame
        : readPng(goldenPath(goldenDirectory, `viv-overlay-${kind}`));
      const comparison = compareFrames(frame, expected, {
        ...overlayTolerance,
        ...(allowed === undefined
          ? {}
          : { maxDifferingFraction: allowed, maxMeanChannelError: 255 }),
      });
      console.log(
        `overlay ${kind} on ${route}: differing ${(comparison.differingFraction * 100).toFixed(3)}% maxDelta ${comparison.maxDelta.join(",")} mean ${comparison.meanError.map((error) => error.toFixed(3)).join(",")}`,
      );
      expect(comparison.failures).toEqual([]);
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
  expect(result.uncapturedGpuErrors).toBe(registered.includes("deck-webgpu") ? 0 : null);
  expectGolden(frame, scene.name, scene.format, testInfo.outputDir);
});
