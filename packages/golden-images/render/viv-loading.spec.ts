import { expect, type Page, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import {
  type SyntheticHarness,
  type SyntheticRequest,
  syntheticHarnessGlobal,
} from "../harness/viv/synthetic-protocol.ts";
import type { Frame } from "../src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../src/playwright.ts";
import { harnessUrl, startVivHarness } from "./viv-harness.ts";

test.describe.configure({ mode: "serial", timeout: 180_000 });

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  server = await startVivHarness();
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

const background = [0xf2, 0xf2, 0xf2];

const inside = { zoom: 1, x: 1024, y: 768 };

const zoomedOut = { zoom: -2, x: 1024, y: 768 };

const slideBox = { left: 144, top: 108, right: 656, bottom: 492 };

type Harness = (page: Page) => Promise<void>;

const open: Harness = async (page) => {
  if (server === null) throw new Error("The Viv harness server did not start");
  await page.goto(`${harnessUrl(server)}synthetic.html`);
  await page.waitForFunction((name) => name in globalThis, syntheticHarnessGlobal, {
    timeout: 60_000,
  });
  await assertSwiftShader(page);
};

async function render(page: Page, request: SyntheticRequest) {
  await open(page);
  const result = await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
      if (harness === undefined) throw new Error("The synthetic harness did not load");
      return harness.render(scene);
    },
    { name: syntheticHarnessGlobal, scene: request },
  );
  expect(result.errors).toEqual([]);
  return captureScreenshot(page.locator("#viewer canvas"));
}

function pixelAt(frame: Frame, x: number, y: number): number[] {
  const offset = (y * frame.width + x) * 4;
  return [frame.data[offset] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset + 2] ?? 0];
}

const isBackground = (pixel: number[]) => background.every((value, i) => pixel[i] === value);

const isCoarse = (pixel: number[]) =>
  (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) ||
  (pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255);

function count(
  frame: Frame,
  area: { left: number; top: number; right: number; bottom: number },
  test: (pixel: number[]) => boolean,
): number {
  let found = 0;
  for (let y = area.top; y < area.bottom; y++) {
    for (let x = area.left; x < area.right; x++) {
      if (test(pixelAt(frame, x, y))) found += 1;
    }
  }
  return found;
}

const whole = { left: 0, top: 0, right: 800, bottom: 600 };

test("the coarse level shows stretched under tiles that have not arrived", async ({ page }) => {
  const frame = await render(page, {
    camera: inside,
    interpolation: "finest-nearest",
    tiles: { hold: "finest", settle: false },
  });
  const total = frame.width * frame.height;
  expect(count(frame, whole, isCoarse)).toBeGreaterThan(total * 0.99);
  expect(count(frame, whole, isBackground)).toBe(0);
});

test("past the slide edge the canvas is the plain background and inside it the coarse level shows", async ({
  page,
}) => {
  const frame = await render(page, {
    camera: zoomedOut,
    interpolation: "finest-nearest",
    tiles: { hold: "finest", settle: false },
  });
  const margin = 2;
  const slideArea = {
    left: slideBox.left + margin,
    top: slideBox.top + margin,
    right: slideBox.right - margin,
    bottom: slideBox.bottom - margin,
  };
  const slidePixels = (slideArea.right - slideArea.left) * (slideArea.bottom - slideArea.top);
  expect(count(frame, slideArea, isCoarse)).toBeGreaterThan(slidePixels * 0.99);
  const total = frame.width * frame.height;
  const boxPixels = (slideBox.right - slideBox.left) * (slideBox.bottom - slideBox.top);
  expect(count(frame, whole, isBackground)).toBeGreaterThanOrEqual(total - boxPixels - 1);
  for (const [x, y] of [
    [10, 10],
    [790, 590],
    [slideBox.left - margin * 2, 300],
    [slideBox.right + margin * 2, 300],
    [400, slideBox.top - margin * 2],
    [400, slideBox.bottom + margin * 2],
  ] as const) {
    expect(isBackground(pixelAt(frame, x, y))).toBe(true);
  }
});

test("where no level has loaded the canvas stays clear so the checker underneath shows", async ({
  page,
}) => {
  const frame = await render(page, {
    camera: zoomedOut,
    interpolation: "finest-nearest",
    tiles: { hold: "all", settle: false },
  });
  expect(count(frame, whole, isBackground)).toBe(frame.width * frame.height);
});

test("no frame shows an empty tile during a fling over slowly arriving tiles", async ({ page }) => {
  await open(page);
  await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
      if (harness === undefined) throw new Error("The synthetic harness did not load");
      await harness.render(scene);
    },
    {
      name: syntheticHarnessGlobal,
      scene: {
        camera: { zoom: 1, x: 400, y: 300 },
        interpolation: "finest-nearest",
        tiles: { delayFinestMs: 120, settle: false },
      } satisfies SyntheticRequest,
    },
  );
  const steps = 20;
  let emptiest = 0;
  for (let step = 1; step <= steps; step++) {
    await page.evaluate(
      async ({ name, camera }) => {
        const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
        if (harness === undefined) throw new Error("The synthetic harness did not load");
        await harness.moveTo(camera);
      },
      {
        name: syntheticHarnessGlobal,
        camera: { zoom: 1, x: 400 + step * 60, y: 300 + step * 45 },
      },
    );
    const frame = await captureScreenshot(page.locator("#viewer canvas"));
    emptiest = Math.max(emptiest, count(frame, whole, isBackground));
  }
  expect(emptiest).toBeLessThan(10);
});

test("a tile server that answers late is measured so the hint can fire at one and five seconds", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
      if (harness === undefined) throw new Error("The synthetic harness did not load");
      await harness.render(scene);
    },
    {
      name: syntheticHarnessGlobal,
      scene: {
        camera: inside,
        interpolation: "finest-nearest",
        tiles: { hold: "finest", settle: false },
      } satisfies SyntheticRequest,
    },
  );
  const read = () =>
    page.evaluate((name) => {
      const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
      if (harness === undefined) throw new Error("The synthetic harness did not load");
      return harness.loadState();
    }, syntheticHarnessGlobal);
  const early = await read();
  expect(early.pending).toBeGreaterThan(0);
  expect(early.waitingMs).toBeLessThan(1000);
  await page.waitForTimeout(1000);
  const afterOneSecond = await read();
  expect(afterOneSecond.waitingMs).toBeGreaterThanOrEqual(1000);
  expect(afterOneSecond.waitingMs).toBeLessThan(5000);
  await page.waitForTimeout(4100);
  const afterFiveSeconds = await read();
  expect(afterFiveSeconds.waitingMs).toBeGreaterThanOrEqual(5000);
  expect(afterFiveSeconds.answerMs).toBeGreaterThanOrEqual(5000);
});
