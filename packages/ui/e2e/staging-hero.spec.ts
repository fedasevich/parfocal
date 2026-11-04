import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const hero = (page: Page) => page.locator('[data-slot="staging-hero"]');

test("the open hero has heading, chip, sub-line and a scale with zones, dots and a numbered point", async ({
  page,
}) => {
  await page.goto(story("components-analysis-cards--sentinel-node-staging"));
  await expect(hero(page).locator("h3")).toContainText("Metastasis likely, largest about 7.7 mm");
  await expect(hero(page)).toContainText("Macro if confirmed");
  await expect(hero(page).locator("p")).toContainText("Confirm and measure area 1");
  const zones = hero(page).locator("[data-zone]");
  await expect(zones).toHaveCount(3);
  await expect(zones.nth(0)).toHaveText("ITC");
  await expect(zones.nth(1)).toHaveText("micro");
  await expect(zones.nth(2)).toHaveText("macro");
  await expect(hero(page).locator('[data-part="dot"]')).toHaveCount(3);
  await expect(hero(page).locator('[data-part="point-number"]')).toHaveText("1");
  await expect(hero(page).locator('[data-part="band"]')).toHaveCount(1);
  await expect(hero(page).locator('[data-slot="count-bar"]')).toHaveCount(0);
});

test("the 0.2 and 2 mm lines land on the zone borders", async ({ page }) => {
  await page.goto(story("components-analysis-cards--sentinel-node-staging"));
  const cuts = hero(page).locator('[data-part="cut"]');
  await expect(cuts).toHaveCount(2);
  const zones = hero(page).locator("[data-zone]");
  const micro = (await zones.nth(1).boundingBox())?.x ?? 0;
  const macro = (await zones.nth(2).boundingBox())?.x ?? 0;
  expect(Math.abs(((await cuts.nth(0).boundingBox())?.x ?? 0) - micro)).toBeLessThan(2);
  expect(Math.abs(((await cuts.nth(1).boundingBox())?.x ?? 0) - macro)).toBeLessThan(2);
});

test("a settled large deposit reads settled and keeps the numbered point", async ({ page }) => {
  await page.goto(story("components-analysis-cards--large-deposit-settled"));
  await expect(hero(page).locator("h3")).toContainText("settled");
  await expect(hero(page).locator('[data-part="point-number"]')).toBeVisible();
  await expect(hero(page).locator('[data-slot="count-bar"]')).toHaveCount(0);
});

test("a running read shows the plain heading and no scale", async ({ page }) => {
  await page.goto(story("components-analysis-cards--staging-still-running"));
  await expect(hero(page).locator("h3")).toContainText("Still reading");
  await expect(hero(page).locator('[data-slot="range-bar"]')).toHaveCount(0);
});

test("a cluster adds a count bar with the 200 cell line, empty until counted", async ({ page }) => {
  await page.goto(story("components-analysis-cards--only-a-small-cluster"));
  await expect(hero(page).locator('[data-slot="count-bar"]')).toHaveAttribute(
    "aria-label",
    "0 cells, the line is at 200",
  );
  await expect(hero(page).locator('[data-slot="count-block"]')).toContainText("not counted yet");
});

test("a settled cluster shows the count under the line", async ({ page }) => {
  await page.goto(story("components-analysis-cards--small-cluster-settled"));
  await expect(hero(page).locator('[data-slot="count-bar"]')).toHaveAttribute(
    "aria-label",
    "170 cells, the line is at 200",
  );
  await expect(hero(page).locator('[data-slot="count-block"]')).toContainText("About 170");
});
