import type { Page } from "@playwright/test";

export type Box = { x: number; y: number; width: number; height: number };

export const chromeBudget = 0.35;

export const chromeWidths = [1280, 1440, 1920] as const;

export const chromeHeight = 900;

export const chromeParts = 'header, [data-slot="tool-rail"], [data-slot="side-panel"]';

const clip = (box: Box, width: number, height: number) => {
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(width, box.x + Math.max(0, box.width));
  const bottom = Math.min(height, box.y + Math.max(0, box.height));
  return right > left && bottom > top ? { left, top, right, bottom } : null;
};

export function coveredShare(boxes: Box[], width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  const rects = boxes.flatMap((box) => clip(box, width, height) ?? []);
  const edges = [...new Set(rects.flatMap((rect) => [rect.left, rect.right]))].sort(
    (a, b) => a - b,
  );
  let covered = 0;
  for (let index = 0; index + 1 < edges.length; index += 1) {
    const from = edges[index] ?? 0;
    const to = edges[index + 1] ?? 0;
    const spans = rects
      .filter((rect) => rect.left <= from && rect.right >= to)
      .map((rect) => [rect.top, rect.bottom] as const)
      .sort((a, b) => a[0] - b[0]);
    let run = 0;
    let reach = Number.NEGATIVE_INFINITY;
    for (const [top, bottom] of spans) {
      if (top >= reach) {
        run += bottom - top;
        reach = bottom;
      } else if (bottom > reach) {
        run += bottom - reach;
        reach = bottom;
      }
    }
    covered += run * (to - from);
  }
  return covered / (width * height);
}

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
