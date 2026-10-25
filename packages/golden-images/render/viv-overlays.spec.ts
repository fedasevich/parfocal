import { fileURLToPath } from "node:url";
import { type OverlayKind, overlayStack } from "@parfocal/viewer-engine";
import { expect, type Page, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import type {
  OverlayChange,
  OverlayHarness,
  OverlayRenderRequest,
  OverlayRenderResult,
  ResourceWatch,
} from "../harness/viv/overlay-protocol.ts";
import { overlayHarnessGlobal } from "../harness/viv/overlay-protocol.ts";
import { checkGolden, compareFrames, EXACT, type Frame, type Tolerance } from "../src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../src/playwright.ts";
import { fixtureAvailability, fixtureUrl, harnessUrl, startVivHarness } from "./viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre } from "./viv-scenes.ts";

const overlayTolerance: Tolerance = {
  maxChannelDelta: 4,
  maxDifferingFraction: 0.001,
  maxMeanChannelError: 0.5,
};

const minimumChangedFraction = 0.003;

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
  await page.goto(`${harnessUrl(server)}overlays.html`);
  await page.waitForFunction((name) => name in globalThis, overlayHarnessGlobal, {
    timeout: 60_000,
  });
  await assertSwiftShader(page);
});

function request(
  layers: readonly OverlayKind[],
  options: Partial<Pick<OverlayRenderRequest, "registration" | "reverse">> = {},
): OverlayRenderRequest {
  return {
    url: fixtureUrl("CMU-1.svs"),
    formatId: "aperio-svs",
    layers,
    registration: options.registration ?? "before-mount",
    reverse: options.reverse ?? false,
    viewport: { width: 400, height: 300 },
    centre: cmu1TissueCentre,
    magnification: 10,
    micronsPerPixel: cmu1MicronsPerPixel,
  };
}

async function capture(page: Page): Promise<Frame> {
  return captureScreenshot(page.locator("#viewer canvas"));
}

async function render(
  page: Page,
  layers: readonly OverlayKind[],
  options: Partial<Pick<OverlayRenderRequest, "registration" | "reverse">> = {},
): Promise<{ readonly result: OverlayRenderResult; readonly frame: Frame }> {
  const result = await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, OverlayHarness>)[name];
      if (harness === undefined) throw new Error("The overlay harness did not load");
      return harness.render(scene);
    },
    { name: overlayHarnessGlobal, scene: request(layers, options) },
  );
  return { result, frame: await capture(page) };
}

async function change(page: Page, operation: OverlayChange): Promise<Frame> {
  await page.evaluate(
    async ({ name, operation: next }) => {
      const harness = (globalThis as unknown as Record<string, OverlayHarness>)[name];
      if (harness === undefined) throw new Error("The overlay harness did not load");
      return harness.change(next);
    },
    { name: overlayHarnessGlobal, operation },
  );
  return capture(page);
}

async function inHarness<Result>(page: Page, call: string, argument?: string): Promise<Result> {
  return page.evaluate(
    ({ name, method, value }) => {
      const harness = (globalThis as unknown as Record<string, Record<string, unknown>>)[name];
      const run = harness?.[method];
      if (typeof run !== "function") throw new Error(`The overlay harness has no ${method}`);
      return run.call(harness, value) as Result;
    },
    { name: overlayHarnessGlobal, method: call, value: argument },
  );
}

function changedFraction(frame: Frame, base: Frame): number {
  return compareFrames(frame, base, EXACT).differingFraction;
}

function expectSame(actual: Frame, expected: Frame, label: string): void {
  const comparison = compareFrames(actual, expected, EXACT);
  expect(comparison.differingPixels, label).toBe(0);
}

async function baseFrame(page: Page): Promise<Frame> {
  const { result, frame } = await render(page, []);
  expect(result.errors).toEqual([]);
  return frame;
}

for (const kind of overlayStack) {
  test(`the ${kind} layer matches its golden image over CMU-1.svs`, async ({ page }, testInfo) => {
    const base = await baseFrame(page);
    const { result, frame } = await render(page, [kind]);
    expect(result.errors).toEqual([]);
    expect(result.layerIds).toEqual([kind]);
    expect(changedFraction(frame, base)).toBeGreaterThan(minimumChangedFraction);
    const outcome = checkGolden(frame, {
      name: `viv-overlay-${kind}`,
      format: "svs-jpeg",
      tolerance: overlayTolerance,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

test("all seven layers stacked match their golden image", async ({ page }, testInfo) => {
  const { result, frame } = await render(page, overlayStack);
  expect(result.errors).toEqual([]);
  const outcome = checkGolden(frame, {
    name: "viv-overlay-stack",
    format: "svs-jpeg",
    tolerance: overlayTolerance,
    goldenDirectory,
    outputDirectory: testInfo.outputDir,
  });
  if (outcome.status === "mismatched") throw new Error(outcome.message);
});

test("registering the stack in reverse, after the slide opened, draws the same frame", async ({
  page,
}) => {
  const { frame: forward } = await render(page, overlayStack);
  const { result, frame: backward } = await render(page, overlayStack, {
    registration: "after-open",
    reverse: true,
  });
  expect(result.errors).toEqual([]);
  expectSame(backward, forward, "reverse and late registration");
});

test("every golden is a different picture of the same slide", async ({ page }) => {
  const base = await baseFrame(page);
  const seen: Frame[] = [];
  for (const kind of overlayStack) {
    const { frame } = await render(page, [kind]);
    for (const other of seen) {
      expect(compareFrames(frame, other, EXACT).differingPixels).toBeGreaterThan(0);
    }
    seen.push(frame);
    expect(changedFraction(frame, base)).toBeGreaterThan(0);
  }
});

test("coverage and heatmap rasters are not flipped", async ({ page }, testInfo) => {
  const { frame } = await render(page, ["coverage"]);
  const base = await baseFrame(page);
  const covered = (top: number, bottom: number, left: number, right: number): number => {
    let changed = 0;
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * frame.width + x) * 4;
        if (frame.data[offset + 1] !== base.data[offset + 1]) changed++;
      }
    }
    return changed / ((bottom - top) * (right - left));
  };
  testInfo.annotations.push({ type: "info", description: "L shape: left strip and bottom strip" });
  expect(covered(0, 200, 0, 90)).toBeGreaterThan(0.9);
  expect(covered(230, 300, 0, 400)).toBeGreaterThan(0.9);
  expect(covered(0, 200, 120, 400)).toBeLessThan(0.01);
});

test("hiding every layer draws the bare slide and showing them again draws the stack", async ({
  page,
}) => {
  const base = await baseFrame(page);
  const { frame: stack } = await render(page, overlayStack);
  let frame = stack;
  for (const kind of overlayStack) {
    frame = await change(page, { kind: "visible", id: kind, visible: false });
  }
  expectSame(frame, base, "all hidden");
  for (const kind of overlayStack) {
    frame = await change(page, { kind: "visible", id: kind, visible: true });
  }
  expectSame(frame, stack, "all shown again");
});

test("opacity fades a layer between the bare slide and the full layer", async ({ page }) => {
  const base = await baseFrame(page);
  const { frame: full } = await render(page, ["heatmap"]);
  const half = await change(page, { kind: "opacity", id: "heatmap", opacity: 0.5 });
  const none = await change(page, { kind: "opacity", id: "heatmap", opacity: 0 });
  const restored = await change(page, { kind: "opacity", id: "heatmap", opacity: 1 });
  const meanOf = (frame: Frame) =>
    compareFrames(frame, base, { ...EXACT, maxMeanChannelError: 255 }).meanError.reduce(
      (sum, error) => sum + error,
      0,
    );
  expect(meanOf(half)).toBeGreaterThan(meanOf(none));
  expect(meanOf(half)).toBeLessThan(meanOf(full));
  expectSame(none, base, "opacity 0");
  expectSame(restored, full, "opacity back to 1");
});

test("removing a layer frees it and the bare slide is drawn again", async ({ page }) => {
  const base = await baseFrame(page);
  const { result } = await render(page, ["nuclei", "comment-pins"]);
  expect(result.layerIds).toEqual(["nuclei", "comment-pins"]);
  await change(page, { kind: "remove", id: "nuclei" });
  const frame = await change(page, { kind: "remove", id: "comment-pins" });
  expectSame(frame, base, "both removed");
});

test("removing a layer destroys its models and GPU buffers, hiding it does not", async ({
  page,
}) => {
  await render(page, ["nuclei", "heatmap"]);
  const before = await inHarness<ResourceWatch>(page, "watch", "nuclei");
  expect(before.watched).toBeGreaterThan(4);
  expect(before.destroyed).toBe(0);
  await change(page, { kind: "visible", id: "nuclei", visible: false });
  expect(await inHarness<ResourceWatch>(page, "watched")).toEqual(before);
  await change(page, { kind: "visible", id: "nuclei", visible: true });
  await change(page, { kind: "remove", id: "nuclei" });
  const after = await inHarness<ResourceWatch>(page, "watched");
  expect(after.destroyed).toBe(after.watched);
});

test("invalidating a layer rebuilds it and draws the same frame", async ({ page }) => {
  const { frame } = await render(page, overlayStack);
  const again = await change(page, { kind: "invalidate", id: "nuclei" });
  expectSame(again, frame, "after invalidating the nuclei");
});
