import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const chipOf = (page: import("@playwright/test").Page) => page.locator('[data-slot="filter-chip"]');

test("a closed chip reads the label and any, and opens a list with Any first", async ({ page }) => {
  await page.goto(story("controls-filter-chip--closed"));
  const chip = chipOf(page);
  await expect(chip).toHaveText("Status: any");
  await expect(chip).not.toHaveAttribute("data-active", "true");
  await chip.click();
  const options = page.getByRole("option");
  await expect(options).toHaveCount(5);
  await expect(options.first()).toContainText("Any status");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
});

test("picking an option closes the list, marks the chip and can be undone with Any", async ({
  page,
}) => {
  await page.goto(story("controls-filter-chip--open"));
  const chip = chipOf(page);
  await page.getByRole("option", { name: "In review" }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(chip).toHaveText("Status: In review");
  await expect(chip).toHaveAttribute("data-active", "true");
  await chip.click();
  await expect(page.getByRole("option", { name: "In review" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("option", { name: "Any status" }).click();
  await expect(chip).toHaveText("Status: any");
});

test("the arrow keys move through the options and Enter picks one", async ({ page }) => {
  await page.goto(story("controls-filter-chip--open"));
  await expect(page.getByRole("option", { name: "Any status" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Ready" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Signed off" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(chipOf(page)).toHaveText("Status: Submitted");
});

test("Escape closes the list, keeps the choice and returns focus to the chip", async ({ page }) => {
  await page.goto(story("controls-filter-chip--chosen"));
  const chip = chipOf(page);
  await chip.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(chip).toHaveText("Status: In review");
  await expect(chip).toBeFocused();
});

test("a long list gets a search that ignores case and accents", async ({ page }) => {
  await page.goto(story("controls-filter-chip--with-search"));
  const search = page.getByRole("textbox", { name: "Find a project" });
  await expect(search).toBeFocused();
  await expect(page.getByRole("option")).toHaveCount(8);
  await search.fill("PROSTATE");
  await expect(page.getByRole("option")).toHaveCount(1);
  await search.fill("p1");
  await expect(page.getByRole("option")).toHaveCount(5);
  await search.fill("zzz");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("Nothing matches that.")).toBeVisible();
  await search.fill("kidney");
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(chipOf(page)).toHaveText("Project: Kidney biopsy triage");
});

test("a chip with nothing to filter by says so", async ({ page }) => {
  await page.goto(story("controls-filter-chip--no-options"));
  await expect(page.getByText("Nothing to filter by yet.")).toBeVisible();
});
