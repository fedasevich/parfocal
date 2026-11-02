import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

test("the calendar starts weeks on Monday and marks today", async ({ page }) => {
  await page.goto(story("controls-date-picker--empty-open"));
  const firstWeek = page.getByRole("row").first().getByRole("button");
  await expect(firstWeek.first()).toHaveAccessibleName(/^Monday/);
  await expect(page.getByRole("button", { name: /^Today, Thursday, 15 October/ })).toHaveText("15");
});

test("picking a day shows it on the trigger and closes the calendar", async ({ page }) => {
  await page.goto(story("controls-date-picker--empty-open"));
  await page.getByRole("button", { name: /^Tuesday, 20 October/ }).click();
  await expect(page.getByRole("grid")).toBeHidden();
  await expect(page.locator('[data-slot="date-picker"]')).toContainText("20 Oct 2026");
});

test("days before the minimum date cannot be picked", async ({ page }) => {
  await page.goto(story("controls-date-picker--with-min-date"));
  await expect(page.getByRole("button", { name: /^Wednesday, 14 October/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Friday, 16 October/ })).toBeEnabled();
});
