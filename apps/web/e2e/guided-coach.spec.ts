import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const lastTip = (page: Page) =>
  page.getByText("The next object comes by itself. The dots take you back to any of them.");
const firstTip = (page: Page) => page.getByText("The AI found this. It is outlined in white.");
const gotIt = (page: Page) => page.getByRole("button", { name: "Got it, start" });

test("the four tips show once on a first visit and Got it, start dismisses them for good", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}`);
  await expect(firstTip(page)).toBeVisible();
  await expect(lastTip(page)).toBeVisible();
  await gotIt(page).click();
  await expect(lastTip(page)).toHaveCount(0);
  await expect(firstTip(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/The AI says T\d+ is/)).toBeVisible();
  await expect(lastTip(page)).toHaveCount(0);
});

test("How guided review works in the More menu brings the tips back", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}`);
  await gotIt(page).click();
  await expect(lastTip(page)).toHaveCount(0);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "How guided review works" }).click();
  await expect(lastTip(page)).toBeVisible();
  await gotIt(page).click();
  await expect(lastTip(page)).toHaveCount(0);
});

test("a scene or a deep link to an object does not open the tips", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await expect(page.getByText(/The AI says T\d+ is/)).toBeVisible();
  await expect(lastTip(page)).toHaveCount(0);
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&object=T2`);
  await expect(page.getByText(/The AI says T2 is/)).toBeVisible();
  await expect(lastTip(page)).toHaveCount(0);
});

test("the first scene keeps showing the tips and Got it, start opens the region scene", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=first`);
  await expect(lastTip(page)).toBeVisible();
  await gotIt(page).click();
  await expect(page).toHaveURL(/scene=region/);
});
