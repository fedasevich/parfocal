import { expect, test } from "@playwright/test";
import type {} from "../src/debug-handle.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test("the debug handle reads and moves the full viewer camera", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&x=0.25&y=0.75&z=6`);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  const first = await page.evaluate(() => window.__parfocal?.getCamera?.() ?? null);
  expect(first?.scale).toBe(6);
  expect(first?.x).toBeGreaterThan(0);
  expect(first?.y).toBeGreaterThan(first?.x ?? 0);
  await page.evaluate((camera) => window.__parfocal?.setCamera?.(camera), {
    x: (first?.x ?? 0) * 2,
    y: (first?.y ?? 0) / 3,
    scale: 4,
  });
  await expect.poll(() => page.evaluate(() => window.__parfocal?.getCamera?.()?.scale)).toBe(4);
  await expect.poll(() => new URL(page.url()).searchParams.get("z")).toBe("4");
  expect(new URL(page.url()).searchParams.get("x")).toBe("0.5");
  expect(new URL(page.url()).searchParams.get("y")).toBe("0.25");
});

test("the developer drawer names the debug handle", async ({ page }) => {
  await page.goto("/developer?section=ref");
  await expect(page.getByText("window.__parfocal", { exact: true })).toBeVisible();
  await expect(page.getByText("window.__wsi")).toHaveCount(0);
  expect(await page.evaluate(() => typeof window.__parfocal)).toBe("object");
});
