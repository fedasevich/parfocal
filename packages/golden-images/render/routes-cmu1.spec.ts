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
  assertGpuMode,
  captureScreenshot,
  gpuLaunch,
  onHardwareGpu,
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
import {
  cmu1MicronsPerPixel,
  cmu1TissueCentre,
  translucentOutlineGolden,
  translucentOutlineKinds,
  translucentOutlineOpacity,
  VIV_SCENES,
} from "./viv-scenes.ts";

const overlayTolerance: Tolerance = {
  maxChannelDelta: 4,
  maxDifferingFraction: 0.001,
  maxMeanChannelError: 0.5,
};

const platformGoldenKinds: ReadonlySet<OverlayKind> = new Set(["id-labels"]);

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const availability = fixtureAvailability("CMU-1.svs");

const hardware = onHardwareGpu();

test.use(gpuLaunch(WEBGPU_SWIFTSHADER_ARGS));
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
  await assertGpuMode(page);
});

const routeTasks: Record<RendererRouteId, string> = {
  viv: "the primary route",
  "deck-webgpu": "VIEW-037 (the deck.gl 9.4 WebGPU route) registers it",
  "custom-webgpu": "VIEW-038 (the custom WebGPU engine route) registers it",
};

const undrawnKinds: Partial<Record<RendererRouteId, ReadonlySet<OverlayKind>>> = {};

const alternateRoutes = RENDERER_ROUTE_IDS.filter((route) => route !== PRIMARY_RENDERER_ROUTE);

function report(
  label: string,
  frame: Frame,
  expected: Frame,
  tolerance: Tolerance,
): readonly string[] {
  const comparison = compareFrames(frame, expected, tolerance);
  console.log(
    `${hardware ? "hardware" : "swiftshader"} ${label}: differing ${(comparison.differingFraction * 100).toFixed(3)}% maxDelta ${comparison.maxDelta.join(",")} mean ${comparison.meanError.map((error) => error.toFixed(3)).join(",")}`,
  );
  return comparison.failures;
}

function expectGolden(
  frame: Frame,
  name: string,
  format: SlideFormat,
  outputDirectory: string,
  tolerance?: Tolerance,
) {
  if (hardware) {
    report(`${name} against the golden`, frame, readPng(goldenPath(goldenDirectory, name)), {
      ...overlayTolerance,
      ...tolerance,
    });
    return;
  }
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
  kinds: OverlayKind | readonly OverlayKind[],
  route: RendererRouteId,
  opacity?: number,
): Promise<{ readonly result: OverlayRenderResult; readonly frame: Frame }> {
  await page.goto(`${harnessUrl(server)}overlays.html`);
  await page.waitForFunction((name) => name in globalThis, overlayHarnessGlobal, {
    timeout: 60_000,
  });
  const layers = typeof kinds === "string" ? [kinds] : kinds;
  const result = await page.evaluate(
    async ({ name, scene, fade }) => {
      const harness = (globalThis as unknown as Record<string, OverlayHarness>)[name];
      if (harness === undefined) throw new Error("The overlay harness did not load");
      let rendered = await harness.render(scene);
      if (fade === null) return rendered;
      for (const id of scene.layers) {
        rendered = await harness.change({ kind: "opacity", id, opacity: fade });
      }
      return rendered;
    },
    {
      name: overlayHarnessGlobal,
      fade: opacity ?? null,
      scene: {
        url: fixtureUrl("CMU-1.svs"),
        formatId: "aperio-svs" as const,
        layers,
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

test("translucent outlines match their golden image on the primary route", async ({ page }) => {
  if (server === null) throw new Error("The Viv harness server did not start");
  const { result, frame } = await renderOverlay(
    page,
    server,
    translucentOutlineKinds,
    PRIMARY_RENDERER_ROUTE,
    translucentOutlineOpacity,
  );
  expect(result.errors).toEqual([]);
  const failures = report(
    `${translucentOutlineGolden} on ${PRIMARY_RENDERER_ROUTE}`,
    frame,
    readPng(goldenPath(goldenDirectory, translucentOutlineGolden)),
    overlayTolerance,
  );
  if (!hardware) expect(failures).toEqual([]);
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
      if (hardware) {
        const viv = await renderVivFrame(page, scene);
        report(`${scene.name} on ${route} against viv`, frame, viv.frame, overlayTolerance);
      }
    });
  }

  test(`translucent outlines match their golden image on the ${route} route`, async ({
    page,
  }, testInfo) => {
    await skipUnlessRegistered(page, route);
    if (server === null) throw new Error("The Viv harness server did not start");
    const { result, frame } = await renderOverlay(
      page,
      server,
      translucentOutlineKinds,
      route,
      translucentOutlineOpacity,
    );
    expect(result.errors).toEqual([]);
    expect(result.uncapturedGpuErrors).toBe(0);
    expect(contentProblems(frame)).toEqual([]);
    const failures = report(
      `${translucentOutlineGolden} on ${route}`,
      frame,
      readPng(goldenPath(goldenDirectory, translucentOutlineGolden)),
      overlayTolerance,
    );
    if (hardware) {
      const viv = await renderOverlay(
        page,
        server,
        translucentOutlineKinds,
        PRIMARY_RENDERER_ROUTE,
        translucentOutlineOpacity,
      );
      report(
        `${translucentOutlineGolden} on ${route} against viv`,
        frame,
        viv.frame,
        overlayTolerance,
      );
      return;
    }
    if (failures.length > 0) {
      expectGolden(
        frame,
        translucentOutlineGolden,
        "svs-jpeg",
        testInfo.outputDir,
        overlayTolerance,
      );
    }
  });

  for (const kind of overlayStack) {
    const reference = platformGoldenKinds.has(kind)
      ? "the Viv frame of the same browser"
      : "its Viv golden image";
    test(`the ${kind} layer matches ${reference} on the ${route} route`, async ({ page }) => {
      await skipUnlessRegistered(page, route);
      test.skip(
        undrawnKinds[route]?.has(kind) === true,
        `The ${route} route reports the ${kind} layer as left out and does not draw it yet`,
      );
      if (server === null) throw new Error("The Viv harness server did not start");
      const { result, frame } = await renderOverlay(page, server, kind, route);
      expect(result.errors).toEqual([]);
      expect(result.uncapturedGpuErrors).toBe(0);
      expect(result.layerIds).toEqual([kind]);
      expect(contentProblems(frame)).toEqual([]);
      const expected = platformGoldenKinds.has(kind)
        ? (await renderOverlay(page, server, kind, PRIMARY_RENDERER_ROUTE)).frame
        : readPng(goldenPath(goldenDirectory, `viv-overlay-${kind}`));
      const failures = report(`overlay ${kind} on ${route}`, frame, expected, overlayTolerance);
      if (hardware) {
        const viv = await renderOverlay(page, server, kind, PRIMARY_RENDERER_ROUTE);
        report(`overlay ${kind} on viv`, viv.frame, expected, overlayTolerance);
        report(`overlay ${kind} on ${route} against viv`, frame, viv.frame, overlayTolerance);
        return;
      }
      expect(failures).toEqual([]);
    });
  }
}

test("a lost device on the custom-webgpu route recovers and redraws the same frame", async ({
  page,
}) => {
  await skipUnlessRegistered(page, "custom-webgpu");
  if (server === null) throw new Error("The Viv harness server did not start");
  const kinds: readonly OverlayKind[] = ["heatmap", "nuclei", "id-labels", "comment-pins"];
  const before = await renderOverlay(page, server, kinds, "custom-webgpu");
  expect(before.result.errors).toEqual([]);
  expect(before.result.deviceRecoveries).toBe(0);
  expect(contentProblems(before.frame)).toEqual([]);
  const lose = () =>
    page.evaluate(async (name) => {
      const harness = (globalThis as unknown as Record<string, OverlayHarness>)[name];
      if (harness === undefined) throw new Error("The overlay harness did not load");
      return harness.change({ kind: "lose-device" });
    }, overlayHarnessGlobal);
  for (let loss = 1; loss <= 2; loss++) {
    const after = await lose();
    expect(after.errors).toEqual([]);
    expect(after.uncapturedGpuErrors).toBe(0);
    expect(after.deviceRecoveries).toBe(loss);
    expect(after.layerIds).toEqual(before.result.layerIds);
    const frame = await captureScreenshot(page.locator("#viewer canvas"));
    expect(compareFrames(frame, before.frame, overlayTolerance).failures).toEqual([]);
  }
});

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
  if (hardware)
    report(`${scene.name} after the switches against viv`, frame, plain.frame, overlayTolerance);
});
