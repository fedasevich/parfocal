import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./a11y.ts";

test("the first-run offer starts the tour and the ten steps reach Done", async ({ page }) => {
  test.slow();
  await page.goto("/");
  const offer = page.getByRole("region", { name: "Tour offer" });
  await expect(offer).toBeVisible({ timeout: 20_000 });
  const offerBackground = await offer.evaluate((node) => getComputedStyle(node).backgroundColor);
  expect(offerBackground).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  await expect(page.getByRole("region", { name: "Quick survey" })).toBeHidden();
  await offer.getByRole("button", { name: "Take the tour" }).click();
  const tour = page.getByRole("dialog", { name: "Guided tour" });
  for (let step = 1; step <= 9; step += 1) {
    await expect(tour).toContainText(`Step ${step} of 10`);
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(page).toHaveURL(/\/settings\/shortcuts/);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(tour).toContainText("Step 10 of 10");
  await tour.getByRole("button", { name: "Done" }).click();
  await expect(tour).toBeHidden();
});

test("Help in the account menu opens the topics and stopping keeps the place", async ({ page }) => {
  test.slow();
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Help and what's new" }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help).toContainText("Review an AI result");
  await expect(help.getByRole("heading", { name: "What's new" })).toBeVisible();
  await expect(help.getByRole("heading", { name: /^v\d+\.\d+\.\d+ \(/ }).first()).toBeVisible();
  await page.mouse.move(0, 0);
  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  expect(results.violations.map((item) => item.id)).toEqual([]);
  await help.getByRole("button", { name: "Take the tour" }).click();
  const tour = page.getByRole("dialog", { name: "Guided tour" });
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Stop tour" }).click();
  await expect(tour).toBeHidden();
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Help and what's new" }).click();
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
  await page.getByRole("button", { name: "Resume the tour" }).click();
  await expect(tour).toContainText("Step 3 of 10");
});
