import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const line = (page: Page) => page.locator('[data-slot="number-line"]');
const part = async (page: Page, name: string) => {
  const node = line(page).locator(
    `[data-slot="number-line-total"] [data-part="${name}"][data-count]`,
  );
  return (await node.count()) === 0 ? 0 : Number(await node.getAttribute("data-count"));
};

test("the seeded number line shows a bar per class and the three total parts", async ({ page }) => {
  await page.goto(story("components-review--number-line-seeded"));
  await expect(line(page).locator('[data-slot="number-line-class"]')).toHaveCount(3);
  const tumor = line(page).locator('[data-class="Tumor"]');
  await expect(tumor.locator('[data-part="sure"]')).toHaveAttribute("data-count", "11190");
  await expect(tumor.locator('[data-part="unsure"]')).toHaveAttribute("data-count", "14");
  const legend = line(page).locator('[data-slot="number-line-legend"]');
  await expect(legend).toContainText("35 checked by you");
  await expect(legend).toContainText("17,745 sure");
  await expect(legend).toContainText("24 unsure of 17,804");
  const sum =
    (await part(page, "checked")) + (await part(page, "sure")) + (await part(page, "unsure"));
  expect(sum).toBe(17804);
  await expect(line(page).locator('[data-slot="result-chip"]')).toHaveCount(0);
});

test("the unsure part is hatched in the unsure token", async ({ page }) => {
  await page.goto(story("components-review--number-line-seeded"));
  const image = await line(page)
    .locator('[data-class="Stroma"] [data-part="unsure"]')
    .evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(image).toContain("repeating-linear-gradient");
});

test("the cutoff chip shows when a result is given", async ({ page }) => {
  await page.goto(story("components-review--number-line-with-chip"));
  await expect(line(page).locator('[data-slot="result-chip"]')).toBeVisible();
});

test("all checked leaves no unsure part", async ({ page }) => {
  await page.goto(story("components-review--number-line-all-checked"));
  await expect(line(page).locator('[data-part="unsure"][data-count]')).toHaveCount(0);
  await expect(line(page).locator('[data-slot="number-line-legend"]')).toContainText(
    "40 checked by you · 0 sure · 0 unsure of 40",
  );
});

test("every answer moves a cell from unsure to checked at once", async ({ page }) => {
  await page.goto(story("components-review--number-line-answering"));
  const legend = line(page).locator('[data-slot="number-line-legend"]');
  await expect(legend).toContainText("24 unsure");
  await page.getByRole("button", { name: "Answer one" }).click();
  await expect(legend).toContainText("36 checked by you");
  await expect(legend).toContainText("23 unsure of 17,804");
});
