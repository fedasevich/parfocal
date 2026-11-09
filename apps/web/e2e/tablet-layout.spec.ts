import { expect, type Page, test } from "./a11y.ts";

const reviewTask = "00000000-0000-4000-8007-000000000014";

test.use({ viewport: { width: 1024, height: 1366 }, hasTouch: true });

const sheet = (page: Page) => page.locator('[data-slot="bottom-sheet"]');
const handle = (page: Page) => page.getByRole("button", { name: "Resize the panel" });

async function openViewer(page: Page) {
  await page.goto("/prototype");
  const href =
    (await page
      .getByRole("list", { name: "Screens" })
      .getByRole("link", { name: "Full viewer · Objects tab", exact: true })
      .getAttribute("href")) ?? "";
  await page.goto(`${new URL(href, "http://localhost").pathname}?task=${reviewTask}`);
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

const heightOf = async (page: Page) => Math.round((await sheet(page).boundingBox())?.height ?? 0);

test("the top bar is 56 px tall and the dock buttons are 56 px", async ({ page }) => {
  await openViewer(page);
  const bar = await page.locator('[data-slot="review-top-bar"]').boundingBox();
  expect(Math.round(bar?.height ?? 0)).toBe(56);
  const buttons = page.locator('[data-slot="tool-rail-button"]');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(3);
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(56);
    expect(Math.round(box?.height ?? 0)).toBe(56);
  }
  const dock = await page.locator('[data-slot="tool-rail"]').boundingBox();
  expect(Math.round(dock?.x ?? 0)).toBe(12);
});

test("the inspector is a bottom sheet that steps through peek, half and full", async ({ page }) => {
  await openViewer(page);
  await expect(sheet(page)).toHaveAttribute("data-height", "peek");
  await expect.poll(() => heightOf(page)).toBe(88);
  await handle(page).tap();
  await expect(sheet(page)).toHaveAttribute("data-height", "half");
  await expect.poll(() => heightOf(page)).toBe(Math.round(1366 * 0.4));
  await handle(page).tap();
  await expect(sheet(page)).toHaveAttribute("data-height", "full");
  await expect.poll(() => heightOf(page)).toBe(Math.round(1366 * 0.85));
  await expect(page.getByRole("complementary", { name: "Side panel" })).toBeVisible();
});

test("the review buttons are between 52 and 60 px tall", async ({ page }) => {
  await openViewer(page);
  await handle(page).tap();
  await handle(page).tap();
  await page
    .getByRole("complementary", { name: "Side panel" })
    .getByRole("button", { name: /^T5 Tumor region(?!.* area \d+$)/ })
    .tap();
  const group = page.getByRole("group", { name: "Your answer on T5" });
  await expect(group).toBeVisible();
  const buttons = group.locator("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const box = await buttons.nth(index).boundingBox();
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(52);
    expect(Math.round(box?.height ?? 0)).toBeLessThanOrEqual(60);
  }
});
