import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import type { SignedHarness, SignedOpenResult } from "../harness/viv/signed-protocol.ts";
import { signedHarnessGlobal } from "../harness/viv/signed-protocol.ts";
import { checkGolden } from "../src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../src/playwright.ts";
import { type SignedTileServer, signedSlideId, signedTileServer } from "./signed-tiles.ts";
import { fixtureAvailability, harnessUrl, startVivHarness } from "./viv-harness.ts";
import { cmu1MicronsPerPixel } from "./viv-scenes.ts";

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));
const availability = fixtureAvailability("CMU-1.svs");

const levelTable = {
  reader: "openslide",
  levels: [
    { index: 0, downsample: 1, width: 46_000, height: 32_914 },
    { index: 1, downsample: 4, width: 11_500, height: 8_228 },
    { index: 2, downsample: 16, width: 2_875, height: 2_057 },
  ].map((level) => ({
    ...level,
    stored: {
      width: level.width,
      height: level.height,
      tile_width: 256,
      tile_height: 256,
      compression: "jpeg",
      photometric: "ycbcr",
    },
  })),
  scale: {
    mpp_x: cmu1MicronsPerPixel,
    mpp_y: cmu1MicronsPerPixel,
    objective_power: 20,
    notices: [],
  },
  planes: 1,
  notices: [],
};

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;
let tiles: SignedTileServer | null = null;

test.beforeAll(async () => {
  if (availability.status === "missing" && availability.required) {
    throw new Error(availability.message);
  }
  if (availability.status !== "ready") return;
  tiles = signedTileServer({ original: "CMU-1.svs", path: availability.path, levelTable });
  server = await startVivHarness([tiles.plugin]);
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
  if (server === null) throw new Error("The harness server did not start");
  if (tiles !== null) tiles.requests.length = 0;
  await page.goto(`${harnessUrl(server)}signed.html`);
  await page.waitForFunction((name) => name in globalThis, signedHarnessGlobal, {
    timeout: 60_000,
  });
  await assertSwiftShader(page);
});

async function openSlide(page: import("@playwright/test").Page): Promise<SignedOpenResult> {
  return page.evaluate(
    async ({ name, slide }) => {
      const harness = (globalThis as unknown as Record<string, SignedHarness>)[name];
      if (harness === undefined) throw new Error("The signed harness did not load");
      return harness.open(slide);
    },
    { name: signedHarnessGlobal, slide: signedSlideId },
  );
}

async function camera(page: import("@playwright/test").Page) {
  return page.evaluate(
    (name) => (globalThis as unknown as Record<string, SignedHarness>)[name]?.camera(),
    signedHarnessGlobal,
  );
}

async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(
    (name) => (globalThis as unknown as Record<string, SignedHarness>)[name]?.settle(),
    signedHarnessGlobal,
  );
}

test("the fitted view opened through signed access matches the fitted golden image", async ({
  page,
}, testInfo) => {
  const result = await openSlide(page);
  expect(result.errors).toEqual([]);
  expect(result.slide).toEqual({ width: 46_000, height: 32_914, micronsPerPixel: 0.499 });
  const frame = await captureScreenshot(page.locator("#viewer canvas"));
  const outcome = checkGolden(frame, {
    name: "viv-cmu-1-svs-fit",
    format: "svs-jpeg",
    goldenDirectory,
    outputDirectory: testInfo.outputDir,
    update: false,
  });
  if (outcome.status === "mismatched") throw new Error(outcome.message);
  const requests = tiles?.requests ?? [];
  const byteReads = requests.filter((entry) => entry.path.endsWith("/CMU-1.svs"));
  expect(byteReads.length).toBeGreaterThan(0);
  expect(requests.filter((entry) => entry.path.startsWith("/tiles/"))).not.toHaveLength(0);
  expect(requests.every((entry) => entry.authorized)).toBe(true);
  expect(requests.filter((entry) => entry.path === "/api/tile-access")).toHaveLength(1);
});

test("the edge stand-in refuses a read without a token and a read with a damaged one", async ({
  page,
}) => {
  const base = harnessUrl(server as ViteDevServer);
  const path = `${base}tiles/${signedSlideId}/levels.json`;
  expect((await page.request.get(path)).status()).toBe(401);
  const damaged = await page.request.get(path, { headers: { authorization: "Bearer YQ.YQ" } });
  expect(damaged.status()).toBe(401);
});

test("the wheel zooms about the pointer and a drag pans", async ({ page }) => {
  await openSlide(page);
  const before = await camera(page);
  const box = await page.locator("#viewer").boundingBox();
  if (box === null) throw new Error("The viewer has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -400);
  await expect
    .poll(async () => (await camera(page))?.zoom ?? Number.NEGATIVE_INFINITY, { timeout: 10_000 })
    .toBeGreaterThan((before?.zoom ?? 0) + 0.2);
  await settle(page);
  const zoomed = await camera(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 120, centre.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await camera(page))?.x ?? 0, { timeout: 10_000 })
    .toBeLessThan((zoomed?.x ?? 0) - 1);
  await settle(page);
  const panned = await camera(page);
  expect(panned?.y).toBeLessThan((zoomed?.y ?? 0) - 1);
  expect(panned?.zoom).toBeGreaterThan((before?.zoom ?? 0) + 0.2);
  const frame = await captureScreenshot(page.locator("#viewer canvas"));
  expect(frame.width).toBe(800);
  expect((tiles?.requests ?? []).every((entry) => entry.authorized)).toBe(true);
});
