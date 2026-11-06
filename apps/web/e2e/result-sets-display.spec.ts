import { expect, type Page, test } from "@playwright/test";

async function displayScene(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Visualize · Display panel, the task default" });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

test("a result set shows dashed behind the task set and hides again", async ({ page }) => {
  await displayScene(page);
  const rows = page.locator('[data-slot="result-set-rows"]');
  await expect(rows).toContainText("Your review");
  const outlines = page.locator('[data-slot="other-set-outlines"]');
  await expect(outlines).toHaveCount(0);
  const first = rows.getByRole("switch").first();
  await expect(first).not.toHaveAttribute("aria-label", "Your review");
  await first.click();
  await expect(first).toBeChecked();
  await expect(outlines).toHaveCount(1);
  await expect(outlines.locator("path").first()).toHaveAttribute("stroke-dasharray", "8 5");
  await first.click();
  await expect(first).not.toBeChecked();
  await expect(outlines).toHaveCount(0);
});

test("hiding Your review removes the added regions from the slide", async ({ page }) => {
  await displayScene(page);
  const mine = page.getByRole("switch", { name: "Your review" });
  await expect(mine).toBeChecked();
  await mine.click();
  await expect(mine).not.toBeChecked();
  await mine.click();
  await expect(mine).toBeChecked();
});
