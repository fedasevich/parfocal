import { expect, type Page, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

const minimap = (page: Page) => page.locator('[data-slot="smart-minimap"]');

async function openScene(page: Page, name: string) {
  await page.goto("/prototype");
  const link = page.getByRole("list", { name: "Screens" }).getByRole("link", { name, exact: true });
  await expect(link).toBeVisible({ timeout: 20_000 });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(minimap(page)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
}

async function panAndKeepCorner(page: Page, from: [number, number], by: [number, number]) {
  const before = await minimap(page).getAttribute("data-corner");
  const viewport = minimap(page).locator('[data-slot="map-viewport"]');
  const startBox = await viewport.boundingBox();
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(from[0] + (by[0] * step) / 6, from[1] + (by[1] * step) / 6);
    await expect(minimap(page)).toHaveAttribute("data-corner", before ?? "");
  }
  await page.mouse.up();
  expect(await viewport.boundingBox()).not.toEqual(startBox);
  return before;
}

const scenes: [string, [number, number], [number, number]][] = [
  ["Smart minimap · Reading at 10x", [500, 400], [-260, -200]],
  ["Smart minimap · Checking cells at 40x", [500, 400], [-200, -150]],
  ["Annotate workspace · Auto region", [600, 450], [-200, -120]],
  ["Focus mode", [500, 400], [-260, -200]],
];

for (const [name, from, by] of scenes) {
  test(`the minimap keeps its corner while the view pans, ${name}`, async ({ page }) => {
    await openScene(page, name);
    const before = await panAndKeepCorner(page, from, by);
    expect(before).not.toBeNull();
    await expect(minimap(page)).toBeVisible();
  });
}
