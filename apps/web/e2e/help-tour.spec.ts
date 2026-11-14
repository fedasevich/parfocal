import { expect, test } from "./a11y.ts";

test("the first-run offer starts the tour and the ten steps reach Done", async ({ page }) => {
  test.slow();
  await page.goto("/");
  const offer = page.getByRole("region", { name: "Tour offer" });
  await expect(offer).toBeVisible({ timeout: 20_000 });
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
  await page.getByRole("menuitem", { name: "Help and tour" }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  await expect(help).toContainText("Review an AI result");
  await help.getByRole("button", { name: "Take the tour" }).click();
  const tour = page.getByRole("dialog", { name: "Guided tour" });
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Stop tour" }).click();
  await expect(tour).toBeHidden();
  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Help and tour" }).click();
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
  await page.getByRole("button", { name: "Resume the tour" }).click();
  await expect(tour).toContainText("Step 3 of 10");
});
