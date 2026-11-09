import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const chip = (page: Page) => page.locator('[data-slot="cell-count-chip"]');
const disagree = (page: Page) =>
  page
    .getByRole("tabpanel")
    .getByRole("button", { name: /Disagree/ })
    .first();
const toast = (page: Page) => page.locator('[data-slot="undo-toast-host"] [data-slot="toast"]');

test("the tumor cell count settles after two disagrees and the toast says to stop", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=grid`);
  await expect(chip(page)).toHaveAttribute("data-phase", "open");
  await expect(chip(page)).toHaveText("About 199 to 202 tumor cells, could be either side of 200");
  await disagree(page).click();
  await expect(chip(page)).toHaveAttribute("data-phase", "open");
  await expect(chip(page)).toHaveText("About 198 to 201 tumor cells, could be either side of 200");
  await expect(page.getByText("You can stop here")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to the answers" }).click();
  await page.getByRole("button", { name: /^T5·C531 tumor 57%/ }).click();
  await disagree(page).click();
  await expect(chip(page)).toHaveAttribute("data-phase", "settled");
  await expect(chip(page)).toHaveText("Under 200 tumor cells (198 to 200), settled");
  await expect(toast(page)).toContainText("You can stop here");
});

test("opening a slide whose count is open shows no toast", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=grid`);
  await expect(chip(page)).toHaveAttribute("data-phase", "open");
  await expect(page.getByText("You can stop here")).toHaveCount(0);
});
