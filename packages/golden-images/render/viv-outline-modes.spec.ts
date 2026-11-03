import { fileURLToPath } from "node:url";
import { type OutlineMode, outlineModes } from "@parfocal/viewer-engine";
import { expect, type Page, test } from "@playwright/test";
import type { ViteDevServer } from "vite";
import {
  type SyntheticHarness,
  type SyntheticRequest,
  syntheticHarnessGlobal,
} from "../harness/viv/synthetic-protocol.ts";
import { checkGolden, compareFrames, EXACT, type Frame, type Tolerance } from "../src/index.ts";
import { assertSwiftShader, captureScreenshot } from "../src/playwright.ts";
import { harnessUrl, startVivHarness } from "./viv-harness.ts";

test.describe.configure({ mode: "serial", timeout: 180_000 });

const goldenDirectory = fileURLToPath(new URL("../goldens", import.meta.url));

const outlineTolerance: Tolerance = {
  maxChannelDelta: 4,
  maxDifferingFraction: 0.001,
  maxMeanChannelError: 0.5,
};

const camera = { x: 1024, y: 768, zoom: 1 };
const viewport = { width: 800, height: 600 };
const cellSpacing = { column: 50, row: 70 };
const firstCell = { x: -150, y: -105 };
const cellBox = 22;

let server: ViteDevServer | null = null;

test.beforeAll(async () => {
  server = await startVivHarness();
});

test.afterAll(async () => {
  await server?.close();
  server = null;
});

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

function cellChange(bare: Frame, drawn: Frame, row: number, column: number): number {
  const centreX = viewport.width / 2 + firstCell.x + column * cellSpacing.column;
  const centreY = viewport.height / 2 + firstCell.y + row * cellSpacing.row;
  let total = 0;
  for (let y = centreY - cellBox; y <= centreY + cellBox; y++) {
    for (let x = centreX - cellBox; x <= centreX + cellBox; x++) {
      const offset = (y * bare.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        total += Math.abs((bare.data[offset + channel] ?? 0) - (drawn.data[offset + channel] ?? 0));
      }
    }
  }
  return total;
}

function newWhitePixels(bare: Frame, drawn: Frame): number {
  let count = 0;
  for (let offset = 0; offset < drawn.data.length; offset += 4) {
    const white = [0, 1, 2].every((channel) => drawn.data[offset + channel] === 255);
    const wasWhite = [0, 1, 2].every((channel) => bare.data[offset + channel] === 255);
    if (white && !wasWhite) count += 1;
  }
  return count;
}

let bare: Frame | null = null;
const frames = new Map<OutlineMode, Frame>();

test("the bare synthetic slide renders", async ({ page }) => {
  bare = await render(page, {});
  expect(bare.width).toBe(viewport.width);
});

for (const mode of outlineModes) {
  test(`the ${mode} outline mode matches its golden image`, async ({ page }, testInfo) => {
    if (bare === null) throw new Error("No bare frame");
    const frame = await render(page, { outlineMode: mode });
    frames.set(mode, frame);
    expect(compareFrames(frame, bare, EXACT).differingFraction).toBeGreaterThan(0.01);
    const outcome = checkGolden(frame, {
      name: `viv-outline-${mode}`,
      format: "synthetic",
      tolerance: outlineTolerance,
      goldenDirectory,
      outputDirectory: testInfo.outputDir,
    });
    if (outcome.status === "mismatched") throw new Error(outcome.message);
  });
}

test("the three modes draw three different pictures of the same cells", () => {
  const drawn = outlineModes.map((mode) => frames.get(mode));
  for (let one = 0; one < drawn.length; one++) {
    for (let two = one + 1; two < drawn.length; two++) {
      const first = drawn[one];
      const second = drawn[two];
      if (first === undefined || second === undefined) throw new Error("A mode did not render");
      expect(compareFrames(first, second, EXACT).differingPixels).toBeGreaterThan(500);
    }
  }
});

test("fade and bands draw a sure cell stronger than a doubtful one in every class", () => {
  if (bare === null) throw new Error("No bare frame");
  for (const mode of ["fade", "bands"] as const) {
    const frame = frames.get(mode);
    if (frame === undefined) throw new Error(`${mode} did not render`);
    for (let row = 0; row < 4; row++) {
      expect(cellChange(bare, frame, row, 0)).toBeGreaterThan(cellChange(bare, frame, row, 6) * 2);
    }
  }
});

test("only mark unsure draws neutral white dashes", () => {
  if (bare === null) throw new Error("No bare frame");
  const marked = frames.get("mark-unsure");
  const fade = frames.get("fade");
  const bands = frames.get("bands");
  if (marked === undefined || fade === undefined || bands === undefined) {
    throw new Error("A mode did not render");
  }
  expect(newWhitePixels(bare, marked)).toBeGreaterThan(300);
  expect(newWhitePixels(bare, fade)).toBe(0);
  expect(newWhitePixels(bare, bands)).toBe(0);
});
