import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const open = (page: Page, name: string) =>
  page.goto(story(`components-inspector-primitives--${name}`));

test("the staging hero shows the range bar with its zones, cuts and three dots", async ({
  page,
}) => {
  await open(page, "mock-six-staging");
  const bar = page.locator('[data-slot="range-bar"]');
  await expect(bar.locator("[data-zone]")).toHaveText(["ITC", "micro", "macro"]);
  await expect(bar.locator('[data-part="cut"]')).toHaveCount(2);
  await expect(bar.locator('[data-part="dot"]')).toHaveCount(3);
  await expect(bar.locator('[data-part="point-number"]')).toHaveText("1");
  await expect(page.locator('[data-slot="count-block"]')).toContainText("About 164 tumor cells");
});

test("the hero says when the tumor cells are not counted yet", async ({ page }) => {
  await open(page, "mock-six-not-counted");
  await expect(page.locator('[data-slot="count-block"]')).toContainText(
    "Tumor cells not counted yet",
  );
});

test("the 7.7 mm point sits to the right of the 2 mm line", async ({ page }) => {
  await open(page, "mock-six-range-bar");
  const bar = page.locator('[data-slot="range-bar"]');
  const point = await bar.locator('[data-part="point"]').boundingBox();
  const cuts = await bar.locator('[data-part="cut"]').all();
  const second = await cuts[1]?.boundingBox();
  expect(point?.x ?? 0).toBeGreaterThan(second?.x ?? Number.POSITIVE_INFINITY);
});

test("a step block collapses to its answer when done", async ({ page }) => {
  await open(page, "mock-six-steps");
  const blocks = page.locator('[data-slot="step-block"]');
  await expect(blocks.nth(0)).toHaveAttribute("data-done", "true");
  await expect(blocks.nth(0)).toContainText("Yes");
  await expect(blocks.nth(1)).not.toHaveAttribute("data-done", "true");
});
