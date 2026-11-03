import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const staging = (page: Page) => page.locator('[data-slot="staging-cards"]');
const tabs = ["Objects", "Display", "Comments", "Opinion"];

test("the sentinel node template puts the staging cards on top of the tabs", async ({ page }) => {
  await page.goto(story("components-analysis-cards--sentinel-node-staging"));
  await expect(staging(page)).toHaveCount(1);
  await expect(staging(page)).toContainText("Metastasis likely, largest about 7.7 mm");
  await expect(staging(page)).toContainText("Macro if confirmed");
  await expect(staging(page)).toHaveAttribute("data-phase", "open");
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-area", "T1");
  await expect(rows.nth(0)).toContainText("1");
  await expect(rows.nth(0)).toContainText("7.7 mm");
  await expect(rows.nth(0)).toContainText("macro");
  await expect(rows.nth(1)).toContainText("micro");
  await expect(rows.nth(2)).toContainText("ITC");
  const card = await staging(page).boundingBox();
  const cardBottom = (card?.y ?? 0) + (card?.height ?? 0);
  const tabTop = (await page.getByRole("tab", { name: "Objects" }).boundingBox())?.y ?? 0;
  expect(cardBottom).toBeLessThanOrEqual(tabTop);
});

for (const [name, id] of [
  ["cell review template", "components-analysis-cards--cell-review"],
  ["project without a template", "components-analysis-cards--no-template"],
] as const) {
  test(`the ${name} shows no staging cards and keeps every tab`, async ({ page }) => {
    await page.goto(story(id));
    for (const tab of tabs) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    await expect(staging(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="staging-hero"]')).toHaveCount(0);
  });
}

test("the staging template with no areas says none were found", async ({ page }) => {
  await page.goto(story("components-analysis-cards--staging-without-areas"));
  await expect(staging(page)).toContainText("No tumor areas found on this slide.");
  await expect(staging(page).locator('[data-slot="region-row"]')).toHaveCount(0);
});

test("the open pre-read shows the size scale and starts with area 1", async ({ page }) => {
  await page.goto(story("components-analysis-cards--sentinel-node-staging"));
  const hero = staging(page).locator('[data-slot="staging-hero"]');
  await expect(hero.locator('[data-slot="range-bar"]')).toHaveCount(1);
  await expect(hero).toContainText("0.2 mm");
  await expect(hero).toContainText("2 mm");
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows.nth(1)).toHaveAttribute("data-area", "T2");
  await expect(rows.nth(2)).toHaveAttribute("data-area", "T3");
  await expect(staging(page)).not.toContainText("Cannot change the category");
  await expect(staging(page).getByRole("button", { name: "Submit" })).toHaveCount(0);
  await staging(page).getByRole("button", { name: "Start with area 1" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-started", "T1");
});

test("once area 1 is confirmed and measured the category is settled", async ({ page }) => {
  await page.goto(story("components-analysis-cards--large-deposit-settled"));
  await expect(staging(page)).toHaveAttribute("data-phase", "settled");
  await expect(staging(page)).toContainText("Macrometastasis, 8.0 mm, settled");
  await expect(staging(page)).toContainText("pN1a(sn)");
  await expect(staging(page)).not.toContainText("if confirmed");
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows.nth(0)).toContainText("8.0 mm");
  await expect(rows.nth(0)).toContainText("Sets the category");
  await expect(rows.nth(1)).toContainText("Cannot change the category");
  await expect(rows.nth(2)).toContainText("Cannot change the category");
  await expect(staging(page).getByRole("button", { name: /Start with/ })).toHaveCount(0);
  await staging(page).getByRole("button", { name: "Submit" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-submitted", "yes");
});
