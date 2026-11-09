import { expect, type Page, test } from "./a11y.ts";

const table = (page: Page) => page.getByRole("table", { name: "All slides" });
const lines = (page: Page) => table(page).locator("tbody tr[data-index]");
const search = (page: Page) => page.getByRole("textbox", { name: "Find a slide, case or ID" });

const openBulk = async (page: Page) => {
  await page.goto("/my-work?tab=all&bulk=10000");
  await expect(table(page)).toHaveAttribute("aria-rowcount", "10008", { timeout: 60_000 });
  await expect(lines(page).first()).toBeVisible();
};

test.describe.configure({ timeout: 120_000 });

test("ten thousand slides render only the rows in view", async ({ page }) => {
  await openBulk(page);
  const shown = await lines(page).count();
  expect(shown).toBeGreaterThan(5);
  expect(shown).toBeLessThan(80);
  await expect(page.getByRole("tab", { name: /All slides/ })).toContainText("10007");
});

test("J moves the selection through the virtual rows and keeps it in view", async ({ page }) => {
  await openBulk(page);
  for (let step = 0; step < 60; step += 1) await page.keyboard.press("j");
  const chosen = table(page).locator("tbody tr[aria-selected='true']");
  await expect(chosen).toHaveAttribute("aria-rowindex", "61");
  await expect(chosen).toBeInViewport();
  expect(await lines(page).count()).toBeLessThan(80);
});

test("the last of ten thousand rows is reachable by scrolling", async ({ page }) => {
  await openBulk(page);
  await page.keyboard.press("k");
  const chosen = table(page).locator("tbody tr[aria-selected='true']");
  await expect(chosen).toContainText("bulk_10000");
  await expect(chosen).toBeInViewport();
  expect(await lines(page).count()).toBeLessThan(80);
});

test("the search filters the ten thousand rows as you type", async ({ page }) => {
  await openBulk(page);
  await search(page).pressSequentially("bulk_0999");
  await expect(lines(page)).toHaveCount(10);
  await expect(page).toHaveURL(/q=bulk_0999/);
  await search(page).press("Backspace");
  await expect(table(page)).toHaveAttribute("aria-rowcount", "101");
  await search(page).fill("bulk_04321");
  await expect(lines(page)).toHaveCount(1);
  await expect(lines(page).first()).toContainText("bulk_04321");
});

test("a double click on a row opens the slide", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  await table(page).locator("tbody tr", { hasText: "tumor_090" }).dblclick();
  await expect(page).not.toHaveURL(/\/my-work/);
});
