import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

for (const width of [820, 1024]) {
  test(`the slide name column keeps its width at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/projects/${p07}?tab=slides`);
    const name = page.getByTestId("slide-name-cell").first();
    await expect(name).toBeVisible();
    const box = await name.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(140);
  });
}
