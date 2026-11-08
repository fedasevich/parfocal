import { expect, type Page, test } from "@playwright/test";

const rt16 = "00000000-0000-4000-8043-000000000016";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1280, height: 900 } });

const callOn = (page: Page, area: string, call: string) =>
  page
    .getByRole("group", { name: `Your call on ${area}` })
    .getByRole("button", { name: new RegExp(`^${call}`) })
    .click();

const goToArea = (page: Page, area: string) =>
  page.getByRole("group", { name: "Objects" }).getByRole("button", { name: area }).click();

const lead = (page: Page) => page.locator("[data-slot=lead-area]");

test("a sentinel task takes all three area calls, hands the category over and lists unsure areas before submit", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt16}/guided?slide=${a1}`);
  await expect(lead(page)).toHaveText("T1 sets the category");
  await expect(page.getByText("Can't change the category", { exact: true })).toBeVisible();

  await callOn(page, "T5", "Tumor");
  await goToArea(page, "T5");
  await callOn(page, "T5", "Unsure");
  await expect(page.getByText("T5: not sure.")).toBeVisible();

  await goToArea(page, "T1");
  await expect(page.getByText("Sets the category", { exact: true })).toBeVisible();
  await callOn(page, "T1", "Not tumor");
  await expect(
    page.getByText("T1: not tumor. It is dropped from the report, and T3 now sets the category."),
  ).toBeVisible();
  await expect(lead(page)).toHaveText("T3 sets the category");

  await page.getByRole("button", { name: /^Cells/ }).click();
  await page.getByRole("button", { name: "Agree with the rest" }).click();
  await page.getByRole("button", { name: /^Agree with 6/ }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByText("Slide 8 is done")).toBeVisible();
  const unsure = page.locator("[data-slot=unsure-list]");
  await expect(unsure).toContainText("Still not sure");
  await expect(unsure.getByRole("listitem")).toHaveText([
    /^T4 is not sure\. The researcher sees it\./,
    /^T5 is not sure\. The researcher sees it\./,
  ]);
});

test("a task without the sentinel template keeps the generic decisions", async ({ page }) => {
  await page.goto(`/tasks/00000000-0000-4000-8007-000000000014/guided?slide=${a1}`);
  await expect(page.getByRole("group", { name: "Your answer on T5" })).toBeVisible();
  await expect(lead(page)).toHaveCount(0);
});
