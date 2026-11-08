import { expect, test } from "@playwright/test";

test("the checklist hides for good through the personal settings", async ({ page }) => {
  await page.goto("/?scene=new");
  const checklist = page.getByRole("region", { name: "Getting started" });
  await expect(checklist).toContainText("3 of 6");
  await page.getByRole("button", { name: "Hide the checklist" }).click();
  await expect(checklist).toBeHidden();
  await expect(page.getByRole("heading", { name: /^Welcome to Parfocal/ })).toBeHidden();
});

test("an unfinished step opens the guided review of the sample", async ({ page }) => {
  await page.goto("/?scene=new");
  await page
    .getByRole("region", { name: "Getting started" })
    .getByRole("button", { name: "Review one slide in guided review" })
    .click();
  await expect(page).toHaveURL(/\/tasks\/sample\/guided/);
});
