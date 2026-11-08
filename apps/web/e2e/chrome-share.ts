import type { Page } from "@playwright/test";
import { type Box, chromePartsSelector, coveredShare } from "../src/telemetry/chrome-coverage.ts";

export { type Box, coveredShare };

export const chromeBudget = 0.35;

export const chromeWidths = [1280, 1440, 1920] as const;

export const chromeHeight = 900;

export const chromeParts = chromePartsSelector;

export async function chromeShare(page: Page, parts: string = chromeParts): Promise<number> {
  const { boxes, width, height } = await page.evaluate((selector) => {
    const found = [...document.querySelectorAll(selector)].map((part) => {
      const box = part.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    return { boxes: found, width: window.innerWidth, height: window.innerHeight };
  }, parts);
  return coveredShare(boxes, width, height);
}
