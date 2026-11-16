import { expect, type Page, test } from "@playwright/test";
import type { Frame } from "../../golden-images/src/frame.ts";
import { captureScreenshot } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";
import type { ChannelsOpened } from "./page/channels-harness.ts";
import type { InputSetup } from "./page/input-harness.ts";

const slide = { width: 1024, height: 768 };
const probeInSlide = { x: 500, y: 100 };
const startCamera = { x: 40_000, y: 30_000, zoom: -3 };
const inputSetup: InputSetup = {
  primaryDragPans: true,
  captureFails: false,
  wheelMode: "auto",
  camera: startCamera,
};
const anchor = { x: 620, y: 260 };

test("the browser offers WebGL2 and reports its WebGPU support", async ({ page, browserName }) => {
  await page.goto(harnessUrl("/app/input.html"));
  const support = await page.evaluate(async () => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const gpu =
      "gpu" in navigator
        ? (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu
        : null;
    const adapter = gpu === null ? null : await gpu.requestAdapter().catch(() => null);
    return {
      webgl2: gl !== null,
      renderer: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "unknown",
      maxTextureSize: gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0,
      floatTextures: gl ? gl.getExtension("EXT_color_buffer_float") !== null : false,
      webgpuApi: gpu !== null,
      webgpuAdapter: adapter !== null,
    };
  });
  console.log(`${browserName} support ${JSON.stringify(support)}`);
  test.info().annotations.push({ type: "support", description: JSON.stringify(support) });
  expect(support.webgl2).toBe(true);
  expect(support.maxTextureSize).toBeGreaterThanOrEqual(4096);
});

async function openInput(page: Page) {
  await page.goto(harnessUrl("/app/input.html"));
  await page.waitForFunction(() => window.inputHarness !== undefined);
  await page.evaluate((setup) => window.inputHarness.setup(setup), inputSetup);
}

const camera = (page: Page) => page.evaluate(() => window.inputHarness.camera());
const whenIdle = (page: Page) => page.evaluate(() => window.inputHarness.whenIdle(5000));

test("a mouse drag pans the slide with the grab cursor and the loop goes idle", async ({
  page,
}) => {
  await openInput(page);
  const before = await camera(page);
  expect(await page.evaluate(() => window.inputHarness.style())).toEqual({
    touchAction: "none",
    userSelect: "none",
    cursor: "grab",
    overscroll: "none",
  });
  await page.mouse.move(400, 350);
  await page.mouse.down();
  await page.mouse.move(520, 350, { steps: 12 });
  expect((await page.evaluate(() => window.inputHarness.style())).cursor).toBe("grabbing");
  await page.mouse.up();
  await whenIdle(page);
  const after = await camera(page);
  const scale = 2 ** before.zoom;
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
  expect((before.x - after.x) * scale).toBeGreaterThan(80);
  expect(Math.abs(after.y - before.y) * scale).toBeLessThan(2);
  expect(await page.evaluate(() => window.inputHarness.motion())).toBe("idle");
});

test("wheel notches zoom in about the cursor and the loop goes idle", async ({ page }) => {
  await openInput(page);
  const before = await camera(page);
  const rect = await page.evaluate(() => window.inputHarness.rect());
  const under = (view: typeof before) => {
    const scale = 2 ** view.zoom;
    return {
      x: view.x + (anchor.x - rect.left - rect.width / 2) / scale,
      y: view.y + (anchor.y - rect.top - rect.height / 2) / scale,
    };
  };
  await page.mouse.move(anchor.x, anchor.y);
  for (let notch = 0; notch < 3; notch++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(40);
  }
  await whenIdle(page);
  const after = await camera(page);
  expect(after.zoom).toBeGreaterThan(before.zoom + 0.1);
  const slideBefore = under(before);
  const slideAfter = under(after);
  const scale = 2 ** after.zoom;
  expect(Math.abs(slideAfter.x - slideBefore.x) * scale).toBeLessThan(1);
  expect(Math.abs(slideAfter.y - slideBefore.y) * scale).toBeLessThan(1);
  expect(await page.evaluate(() => window.inputHarness.motion())).toBe("idle");
});

type Rgb = readonly [number, number, number];

function average(frame: Frame, x: number, y: number): Rgb {
  const total: [number, number, number] = [0, 0, 0];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const at = ((y + dy) * frame.width + x + dx) * 4;
      for (const channel of [0, 1, 2] as const) total[channel] += frame.data[at + channel] ?? 0;
    }
  }
  return [total[0] / 25, total[1] / 25, total[2] / 25];
}

async function colourAtProbe(page: Page, display: readonly Record<string, unknown>[]) {
  const shown = await page.evaluate(
    (wanted) => window.channelsHarness.show(wanted as never),
    display,
  );
  expect(shown.errors).toEqual([]);
  const frame = await captureScreenshot(page.locator("#viewer canvas"));
  const left = (shown.canvas.width - slide.width * shown.scale) / 2;
  const top = (shown.canvas.height - slide.height * shown.scale) / 2;
  return average(
    frame,
    Math.round(left + probeInSlide.x * shown.scale),
    Math.round(top + probeInSlide.y * shown.scale),
  );
}

test("Viv draws a multichannel OME-TIFF on WebGL2 and honours the contrast limits", async ({
  page,
}) => {
  await page.goto(harnessUrl("/app/channels.html"));
  await page.waitForFunction(() => window.channelsHarness !== undefined);
  const opened: ChannelsOpened = await page.evaluate(
    (url) => window.channelsHarness.open(url, "ome-tiff"),
    harnessUrl("/synthetic/synthetic-channels-uint8.ome.tiff"),
  );
  expect(opened.channels).toEqual(["DAPI", "FITC", "TRITC"]);
  const full = await colourAtProbe(page, []);
  const halved = await colourAtProbe(page, [{ contrast: [0, 127] }]);
  const hidden = await colourAtProbe(page, [{ visible: false }]);
  const dapi = (probeInSlide.x / (slide.width - 1)) * 0.6;
  expect(Math.abs(full[2] - dapi * 255)).toBeLessThan(6);
  expect(halved[2] / full[2]).toBeGreaterThan(1.8);
  expect(halved[2] / full[2]).toBeLessThan(2.2);
  expect(hidden[2]).toBeLessThan(full[2]);
});
