import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

async function fullViewerUrl(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return (await link.getAttribute("href")) ?? "";
}

test("the progress ring in the guided top bar opens the review progress popover", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await page.getByRole("button", { name: "Review progress" }).click();
  const popover = page.getByRole("dialog", { name: "Review progress" });
  await expect(popover).toContainText("This slide");
  await expect(popover).toContainText("Whole task");
  await expect(popover).toContainText("Saved as you go");
  await expect(popover.getByRole("button", { name: /Next slide/ })).toHaveCount(0);
  await popover.getByRole("button", { name: "Whole slide" }).click();
  await expect(page.getByText("50 sampled cells").first()).toBeVisible();
});

test("the full viewer ring shows Next slide and the slide chip lists the case", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto(await fullViewerUrl(page));
  await page.getByRole("button", { name: "Review progress" }).click();
  const progress = page.getByRole("dialog", { name: "Review progress" });
  await progress.getByRole("button", { name: /Next slide/ }).click();
  await expect(page).not.toHaveURL(new RegExp(`slides/${a1}`));
  await page.goto(await fullViewerUrl(page));
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const slides = page.getByRole("dialog", { name: "Slides in this case and task" });
  await expect(slides).toContainText("Slides in this case");
  await expect(slides.getByRole("button", { name: "Open the case" })).toBeVisible();
  await expect(slides.getByRole("button", { name: /Add slides/ })).toBeVisible();
  await slides.getByRole("button", { name: "Open the case" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
});

test("the More menu in the annotate top bar opens settings from an item", async ({ page }) => {
  await page.goto("/prototype");
  await page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Annotate workspace · Auto region", exact: true })
    .click();
  await page.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: /Ask for a second opinion/ })).toBeVisible();
  await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
  await expect(page).toHaveURL(/\/settings\/shortcuts/);
});

test("the adjudicator's slide chip lists the slides queued for them", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/disagreements?scene=adjudicate`);
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const queued = page.getByRole("dialog", { name: "Slides with objects queued for you" });
  await expect(queued).toContainText("Slides with objects for you");
  await queued.getByRole("button", { name: /^A1/ }).click();
  await expect(queued).toHaveCount(0);
});
