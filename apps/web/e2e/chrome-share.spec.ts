import { expect, test } from "@playwright/test";
import { chromeBudget, chromeHeight, chromeShare, chromeWidths } from "./chrome-share.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

for (const width of chromeWidths) {
  test(`Review chrome share at ${width}x${chromeHeight}`, async ({ page }) => {
    await page.setViewportSize({ width, height: chromeHeight });
    await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}`);
    await expect(page.getByTestId("full-viewer")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("header").first()).toBeVisible();
    await expect(page.locator('[data-slot="tool-rail"]')).toBeVisible();
    await expect(page.locator('[data-slot="side-panel"]')).toBeVisible();
    const share = await chromeShare(page);
    test.info().annotations.push({ type: "chrome share", description: share.toFixed(3) });
    expect(share).toBeGreaterThan(0);
    if (width === 1440) expect(share).toBeLessThan(chromeBudget);
  });
}
