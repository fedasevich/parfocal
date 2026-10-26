import { expect, type Page, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import { collectGarbage, liveObjects } from "../../viewer-engine/browser/cdp.ts";
import {
  type GpuLossHarness,
  type GpuLossRequest,
  type GpuLossState,
  gpuLossHarnessGlobal,
} from "../harness/viv/gpu-loss-protocol.ts";
import { compareFrames, EXACT, type Frame } from "../src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../src/playwright.ts";
import { fixtureAvailability, fixtureUrl, harnessUrl, startVivHarness } from "./viv-harness.ts";
import { cmu1MicronsPerPixel, cmu1TissueCentre } from "./viv-scenes.ts";

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
  await page.goto(`${harnessUrl(server)}gpu-loss.html`);
  await page.waitForFunction((name) => name in globalThis, gpuLossHarnessGlobal, {
    timeout: 60_000,
  });
  await assertSwiftShader(page);
});

function request(options: Partial<GpuLossRequest> = {}): GpuLossRequest {
  return {
    url: fixtureUrl("CMU-1.svs"),
    formatId: "aperio-svs",
    magnification: 10,
    micronsPerPixel: cmu1MicronsPerPixel,
    centre: cmu1TissueCentre,
    withOverlay: true,
    ...options,
  };
}

async function call<Result>(
  page: Page,
  method: keyof GpuLossHarness,
  ...args: unknown[]
): Promise<Result> {
  return page.evaluate(
    ({ name, method: run, values }) => {
      const harness = (globalThis as unknown as Record<string, Record<string, unknown>>)[name];
      const target = harness?.[run];
      if (typeof target !== "function") throw new Error(`The harness has no ${run}`);
      return (target as (...input: unknown[]) => unknown).apply(harness, values);
    },
    { name: gpuLossHarnessGlobal, method, values: args },
  ) as Promise<Result>;
}

async function open(page: Page, options: Partial<GpuLossRequest> = {}): Promise<void> {
  await call(page, "open", request(options));
  await call(page, "settle", 60_000);
}

function state(page: Page): Promise<GpuLossState> {
  return call(page, "state");
}

async function waitForState(
  page: Page,
  description: string,
  predicate: (current: GpuLossState) => boolean,
  timeoutMs = 20_000,
): Promise<GpuLossState> {
  const deadline = Date.now() + timeoutMs;
  let current = await state(page);
  while (!predicate(current)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(current)}`);
    }
    await page.waitForTimeout(50);
    current = await state(page);
  }
  return current;
}

async function capture(page: Page): Promise<Frame> {
  return captureScreenshot(page.locator("#viewer canvas"));
}

async function liveDecks(page: Page, expected: number): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  let found = -1;
  for (let attempt = 0; attempt < 20; attempt++) {
    await collectGarbage(cdp);
    found = await liveObjects(cdp, `window.${gpuLossHarnessGlobal}.prototypes.deck`);
    if (found === expected) break;
    await page.waitForTimeout(100);
  }
  await cdp.detach();
  return found;
}

async function loseAndRestore(page: Page): Promise<void> {
  const before = (await state(page)).recoveries;
  await call(page, "loseContext");
  await waitForState(page, "the loss to register", (current) => current.status === "lost");
  await call(page, "restoreContext");
  await waitForState(
    page,
    "the viewer to recover",
    (current) => current.status === "ready" && current.recoveries === before + 1,
  );
  await call(page, "settle", 60_000);
}

test("a lost and restored WebGL context redraws the same view, with the overlay and one live Deck", async ({
  page,
}) => {
  await open(page);
  const before = await state(page);
  const frameBefore = await capture(page);
  expect(before.overlayLayerIds.length).toBe(1);
  expect(before.errorNames).toEqual([]);
  expect(await liveDecks(page, 1)).toBe(1);

  await loseAndRestore(page);

  const after = await state(page);
  expect(after.camera).toEqual(before.camera);
  expect(after.slideId).toBe(before.slideId);
  expect(after.overlayLayerIds).toEqual(before.overlayLayerIds);
  expect(after.errorNames).toEqual([]);
  expect(after.canvases).toBe(1);
  expect(after.losses).toBe(1);
  expect(after.recoveries).toBe(1);
  const frameAfter = await capture(page);
  expect(compareFrames(frameAfter, frameBefore, EXACT).differingPixels).toBe(0);
  expect(await liveDecks(page, 1)).toBe(1);
});

test("a camera move during the loss is drawn after the restore", async ({ page }) => {
  await open(page);
  const home = await state(page);
  const frameHome = await capture(page);
  await call(page, "loseContext");
  await waitForState(page, "the loss to register", (current) => current.status === "lost");
  const moved = { ...home.camera, x: home.camera.x + 400, y: home.camera.y + 300 };
  await call(page, "moveTo", moved);
  expect((await state(page)).camera).toEqual(moved);
  await call(page, "restoreContext");
  await waitForState(page, "the viewer to recover", (current) => current.status === "ready");
  await call(page, "settle", 60_000);
  const frameMoved = await capture(page);
  expect(compareFrames(frameMoved, frameHome, EXACT).differingPixels).toBeGreaterThan(1000);
  await call(page, "moveTo", home.camera);
  await call(page, "settle", 60_000);
  expect(compareFrames(await capture(page), frameHome, EXACT).differingPixels).toBe(0);
});

test("a loss while the loop sleeps wakes it and recovers", async ({ page }) => {
  await open(page);
  await waitForState(page, "the loop to sleep", (current) => current.asleep, 30_000);
  const frameBefore = await capture(page);
  await loseAndRestore(page);
  const after = await state(page);
  expect(after.errorNames).toEqual([]);
  expect(compareFrames(await capture(page), frameBefore, EXACT).differingPixels).toBe(0);
  await waitForState(page, "the loop to sleep again", (current) => current.asleep, 30_000);
});

test("three losses in a row recover, and a fourth within the window is unrecoverable", async ({
  page,
}) => {
  await open(page);
  const frameBefore = await capture(page);
  for (let loss = 1; loss <= 3; loss++) {
    await loseAndRestore(page);
    expect((await state(page)).recoveries).toBe(loss);
  }
  expect(compareFrames(await capture(page), frameBefore, EXACT).differingPixels).toBe(0);
  expect(await liveDecks(page, 1)).toBe(1);

  await call(page, "loseContext");
  const failed = await waitForState(page, "the failure", (current) => current.status === "failed");
  expect(failed.failure?.reason).toBe("repeated-loss");
  expect(failed.failure?.userMessage.length).toBeGreaterThan(20);
  expect(failed.errorNames).toEqual(["GpuUnrecoverableError"]);
  expect(failed.settled).toBe(true);
  expect(await call<boolean>(page, "useRoute")).toBe(true);
  const after = await state(page);
  expect(after.errorNames).toEqual(["GpuUnrecoverableError"]);
  expect(after.canvases).toBe(0);
  await call(page, "dispose");
  expect(await liveDecks(page, 0)).toBe(0);
});

test("a context that is never restored ends in one error a UI can show, and nothing throws or hangs", async ({
  page,
}) => {
  await open(page, { restoreTimeoutMs: 500 });
  await call(page, "loseContext");
  const failed = await waitForState(page, "the failure", (current) => current.status === "failed");
  expect(failed.failure?.reason).toBe("restore-timeout");
  expect(failed.errorNames).toEqual(["GpuUnrecoverableError"]);
  expect(failed.errorMessages[0]).toContain("restore-timeout");
  expect(failed.failure?.userMessage).toContain("Reload the page");
  expect(failed.settled).toBe(true);
  expect(failed.canvases).toBe(0);
  expect(await call<boolean>(page, "useRoute")).toBe(true);
  await call(page, "dispose");
  expect(await liveDecks(page, 0)).toBe(0);
});

test("disposing after a recovery leaves no Deck and none of the guard's listeners", async ({
  page,
}) => {
  await open(page);
  await loseAndRestore(page);
  expect((await state(page)).parfocalListeners).toBe(2);
  await call(page, "dispose");
  expect(await liveDecks(page, 0)).toBe(0);
  expect(await page.evaluate(() => document.querySelectorAll("canvas").length)).toBe(0);
  expect(await call<number>(page, "listeners")).toBe(0);
});

test("disposing while the context is lost cancels the wait and leaves no Deck", async ({
  page,
}) => {
  await open(page, { restoreTimeoutMs: 300 });
  await call(page, "loseContext");
  await waitForState(page, "the loss to register", (current) => current.status === "lost");
  await call(page, "dispose");
  await page.waitForTimeout(800);
  expect(await liveDecks(page, 0)).toBe(0);
});
