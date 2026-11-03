import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const block = (page: Page) => page.locator('[data-slot="model-warnings"]');
const toggle = (page: Page) => page.getByRole("switch", { name: "Model warnings" });

test("a typer with no warnings shows no block", async ({ page }) => {
  await page.goto(story("components-model-warnings--no-warning"));
  await expect(toggle(page)).toBeVisible();
  await expect(block(page)).toHaveCount(0);
});

test("one warning shows the block with a single note", async ({ page }) => {
  await page.goto(story("components-model-warnings--one-warning"));
  await expect(block(page).getByRole("heading", { name: "Model warnings" })).toBeVisible();
  const notes = block(page).getByRole("note");
  await expect(notes).toHaveCount(1);
  await expect(notes).toContainText("HoVer-NeXt is not calibrated");
});

test("several warnings list each one in order with a count", async ({ page }) => {
  await page.goto(story("components-model-warnings--several-warnings"));
  const items = block(page).getByRole("listitem");
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toHaveAttribute("data-kind", "low-accuracy");
  await expect(items.nth(1)).toHaveAttribute("data-kind", "site-not-validated");
  await expect(items.nth(2)).toHaveAttribute("data-kind", "out-of-distribution");
  await expect(items.nth(3)).toHaveAttribute("data-kind", "many-unsure");
  await expect(items.nth(1)).toContainText("was not validated on Lymph node tissue");
  await expect(block(page)).toContainText("4");
});

test("turning Model warnings off hides the block and on brings it back", async ({ page }) => {
  await page.goto(story("components-model-warnings--several-warnings"));
  await expect(block(page)).toHaveCount(1);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(block(page)).toHaveCount(0);
  await toggle(page).click();
  await expect(block(page)).toHaveCount(1);
});
