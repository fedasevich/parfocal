import { expect, type Page, test } from "@playwright/test";
import type { Frame } from "../../golden-images/src/frame.ts";
import { captureScreenshot } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";
import type { ChannelsOpened } from "./page/channels-harness.ts";

const slide = { width: 1024, height: 768 };

const probeInSlide = { x: 500, y: 100 };

type Rgb = readonly [number, number, number];

async function openSlide(page: Page, file: string): Promise<ChannelsOpened> {
  await page.goto(harnessUrl("/app/channels.html"));
  await page.waitForFunction(() => window.channelsHarness !== undefined);
  return page.evaluate(
    (url) => window.channelsHarness.open(url, "ome-tiff"),
    harnessUrl(`/synthetic/${file}`),
  );
}

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

async function colourAtProbe(
  page: Page,
  display: readonly Record<string, unknown>[],
): Promise<Rgb> {
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

for (const [file, top] of [
  ["synthetic-channels-uint16.ome.tiff", 65_535],
  ["synthetic-channels-uint8.ome.tiff", 255],
] as const) {
  test(`Viv draws ${file} through its channel contrast limits`, async ({ page }) => {
    const opened = await openSlide(page, file);
    expect(opened.channels).toEqual(["DAPI", "FITC", "TRITC"]);
    expect(opened.dtype).toBe(top === 255 ? "Uint8" : "Uint16");
    const full = await colourAtProbe(page, []);
    const halved = await colourAtProbe(page, [{ contrast: [0, top / 2] }]);
    const offset = await colourAtProbe(page, [{ contrast: [top * 0.2, top] }]);
    const hidden = await colourAtProbe(page, [{ visible: false }]);
    const recoloured = await colourAtProbe(page, [{ color: [255, 255, 0] }]);
    const dapi = (probeInSlide.x / (slide.width - 1)) * 0.6;
    expect(Math.abs(full[2] - dapi * 255)).toBeLessThan(4);
    expect(halved[2] / full[2]).toBeGreaterThan(1.9);
    expect(halved[2] / full[2]).toBeLessThan(2.1);
    expect(halved[0]).toBeCloseTo(full[0], 0);
    expect(halved[1]).toBeCloseTo(full[1], 0);
    expect(Math.abs(offset[2] - ((dapi - 0.2) / 0.8) * 255)).toBeLessThan(4);
    expect(hidden[2]).toBe(0);
    expect(hidden[1]).toBeCloseTo(full[1], 0);
    expect(recoloured[0]).toBeGreaterThan(full[0] + 30);
    expect(recoloured[2]).toBeLessThan(full[2] / 4);
  });
}
