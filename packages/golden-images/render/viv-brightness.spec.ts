import { classColors } from "@parfocal/viewer-engine";
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

const camera = { x: 1024, y: 768, zoom: 1 };
const roundingSlack = 1;

async function render(page: Page, request: Omit<SyntheticRequest, "camera" | "interpolation">) {
  if (server === null) throw new Error("The Viv harness server did not start");
  await page.goto(`${harnessUrl(server)}synthetic.html`);
  await page.waitForFunction((name) => name in globalThis, syntheticHarnessGlobal, {
    timeout: 60_000,
  });
  await assertSwiftShader(page);
  const result = await page.evaluate(
    async ({ name, scene }) => {
      const harness = (globalThis as unknown as Record<string, SyntheticHarness>)[name];
      if (harness === undefined) throw new Error("The synthetic harness did not load");
      return harness.render(scene);
    },
    {
      name: syntheticHarnessGlobal,
      scene: { camera, interpolation: "finest-nearest" as const, ...request },
    },
  );
  expect(result.errors).toEqual([]);
  return captureScreenshot(page.locator("#viewer canvas"));
}

const lineColours = [classColors.tumor, classColors.other].map((colour) => [
  colour[0],
  colour[1],
  colour[2],
]);

function rgbAt(frame: Frame, pixel: number): [number, number, number] {
  const offset = pixel * 4;
  return [frame.data[offset] ?? 0, frame.data[offset + 1] ?? 0, frame.data[offset + 2] ?? 0];
}

const same = (a: readonly number[], b: readonly number[]) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

interface Regions {
  readonly slide: number[];
  readonly lines: number[];
}

function regions(bare: Frame, annotated: Frame): Regions {
  const slide: number[] = [];
  const lines: number[] = [];
  for (let pixel = 0; pixel < bare.width * bare.height; pixel++) {
    const plain = rgbAt(bare, pixel);
    const drawn = rgbAt(annotated, pixel);
    if (same(plain, drawn)) slide.push(pixel);
    else if (lineColours.some((colour) => same(colour, drawn))) lines.push(pixel);
  }
  return { slide, lines };
}

function scaledMismatches(bare: Frame, dimmed: Frame, pixels: number[], factor: number): number {
  let wrong = 0;
  for (const pixel of pixels) {
    const plain = rgbAt(bare, pixel);
    const seen = rgbAt(dimmed, pixel);
    const off = plain.some(
      (channel, index) =>
        Math.abs(Math.min(255, channel * factor) - (seen[index] ?? 0)) > roundingSlack,
    );
    if (off) wrong += 1;
  }
  return wrong;
}

function changedLines(reference: Frame, other: Frame, pixels: number[]): number {
  return pixels.filter((pixel) => !same(rgbAt(reference, pixel), rgbAt(other, pixel))).length;
}

let bare: Frame | null = null;
let annotated: Frame | null = null;
let parts: Regions | null = null;

test("the annotated frame at 100% separates slide pixels from opaque outline pixels", async ({
  page,
}) => {
  bare = await render(page, {});
  annotated = await render(page, { annotations: true });
  parts = regions(bare, annotated);
  expect(parts.slide.length).toBeGreaterThan(bare.width * bare.height * 0.8);
  expect(parts.lines.length).toBeGreaterThan(300);
});

for (const percent of [20, 60, 140]) {
  test(`at ${percent}% only slide pixels change and outlines keep their colour`, async ({
    page,
  }) => {
    if (bare === null || annotated === null || parts === null) throw new Error("No 100% frames");
    const frame = await render(page, { annotations: true, brightness: percent });
    expect(scaledMismatches(bare, frame, parts.slide, percent / 100)).toBe(0);
    expect(changedLines(annotated, frame, parts.lines)).toBe(0);
  });
}

test("dimming the whole canvas with a CSS filter fails the outline check", async ({ page }) => {
  if (annotated === null || parts === null) throw new Error("No 100% frames");
  const frame = await render(page, {
    annotations: true,
    brightness: 60,
    brightnessBy: "css-filter",
  });
  expect(changedLines(annotated, frame, parts.lines)).toBeGreaterThan(parts.lines.length * 0.9);
});

test("the engine keeps brightness between 20% and 140%", async ({ page }) => {
  if (bare === null) throw new Error("No 100% frames");
  const frame = await render(page, { brightness: 5 });
  const everyPixel = Array.from({ length: bare.width * bare.height }, (_, pixel) => pixel);
  expect(scaledMismatches(bare, frame, everyPixel, 0.2)).toBe(0);
});
