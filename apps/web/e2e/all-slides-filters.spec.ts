import { expect, type Page, test } from "@playwright/test";

const chip = (page: Page, label: string) =>
  page.locator('[data-slot="filter-chip"]').filter({ hasText: `${label}:` });

const pick = async (page: Page, label: string, option: string) => {
  await chip(page, label).click();
  await page.getByRole("option", { name: option }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
};

const labels = async (page: Page) =>
  (await page.locator("tbody tr").locator("td:first-child b").allInnerTexts()).sort();

test("every filter chip starts on any and lists what the slides have", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  await expect(page.locator("tbody tr")).toHaveCount(7);
  for (const label of ["Project", "Status", "Result set", "Reviewer"]) {
    await expect(chip(page, label)).not.toHaveAttribute("data-active", "true");
  }
  await chip(page, "Reviewer").click();
  await expect(page.getByRole("option")).toHaveText([
    /Any reviewer/,
    /Anna Kopecká/,
    /Lenka Malá/,
    /Simona Marková/,
  ]);
});

test("a status filter narrows the table and lands in the URL", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  await pick(page, "Status", "Needs results");
  await expect(page).toHaveURL(/status=uploaded/);
  await expect.poll(() => labels(page)).toEqual(["A3", "tumor_052"]);
  await expect(chip(page, "Status")).toHaveText("Status: Needs results");
});

test("filters combine with each other and with the search", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  await pick(page, "Result set", "CAMELYON tumor model v1.0");
  await expect.poll(() => labels(page)).toEqual(["A1", "A2", "tumor_031", "tumor_090"]);
  await pick(page, "Reviewer", "Anna Kopecká");
  await expect.poll(() => labels(page)).toEqual(["tumor_031"]);
  await pick(page, "Reviewer", "Any reviewer");
  await pick(page, "Status", "Ready");
  await expect.poll(() => labels(page)).toEqual(["tumor_090"]);
  await page.getByRole("textbox", { name: "Find a slide, case or ID" }).fill("A1");
  await expect(page.getByText("No slide matches these filters.")).toBeVisible();
  await expect(page).toHaveURL(/q=A1/);
  await expect(page).toHaveURL(/status=ready/);
  await expect(page).toHaveURL(/set=CAMELYON/);
});

test("the filters come back from the URL after a reload and Clear filters resets them", async ({
  page,
}) => {
  await page.goto("/my-work?tab=all");
  await pick(page, "Reviewer", "Simona Marková");
  await pick(page, "Status", "In review");
  await expect.poll(() => labels(page)).toEqual(["A1", "A2"]);
  await page.reload();
  await expect(chip(page, "Reviewer")).toHaveText("Reviewer: Simona Marková");
  await expect(chip(page, "Status")).toHaveText("Status: In review");
  await expect(chip(page, "Reviewer")).toHaveAttribute("data-active", "true");
  await expect.poll(() => labels(page)).toEqual(["A1", "A2"]);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(7);
  await expect(page).not.toHaveURL(/status=|reviewer=/);
  await expect(page.getByRole("button", { name: "Clear filters" })).toHaveCount(0);
});

test("a filter changed with the keyboard reaches the URL and drops the open preview", async ({
  page,
}) => {
  await page.goto("/my-work?tab=all&sel=tumor_090");
  await chip(page, "Status").focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(chip(page, "Status")).toHaveText("Status: Needs results");
  await expect(page).toHaveURL(/status=uploaded/);
  await expect(page).not.toHaveURL(/sel=/);
});
