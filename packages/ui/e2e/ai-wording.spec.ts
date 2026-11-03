import { expect, type Page, test } from "@playwright/test";

const story = (id: string) =>
  `/iframe.html?id=components-ai-wording--${id}&viewMode=story&globals=a11y.manual:!true`;
const row = (page: Page, setting: string) => page.locator(`[data-setting="${setting}"]`);

const measured = [
  { setting: "words", mode: "plain", text: "probably tumor" },
  { setting: "numbers", mode: "percent", text: "tumor 72%" },
  { setting: "frequency", mode: "frequency", text: "tumor, right about 7 in 10 times" },
  { setting: "colour", mode: "colour", text: "tumor" },
];

test("the tile and the inspector word the AI call the way each setting asks", async ({ page }) => {
  await page.goto(story("each-setting"));
  for (const { setting, mode, text } of measured) {
    const tile = row(page, setting).locator('[data-slot="gallery-tile"]');
    await expect(tile).toHaveAttribute("data-wording", mode);
    await expect(tile).toHaveAttribute("data-band", "likely");
    await expect(tile.locator('[data-slot="gallery-tile-label"]')).toHaveText(text);
    const line = row(page, setting).locator('[data-slot="ai-call"]');
    await expect(line).toHaveText(text);
    await expect(line).toHaveAttribute("data-wording", mode);
  }
});

test("hidden keeps the AI call off the tile and out of the inspector", async ({ page }) => {
  await page.goto(story("each-setting"));
  const hidden = row(page, "hidden");
  await expect(hidden.locator('[data-slot="gallery-tile-label"]')).toHaveText("cell");
  await expect(page.getByRole("button", { name: "T1·C144 cell, to check" })).toBeVisible();
  await expect(hidden.locator('[data-slot="ai-call"]')).toHaveCount(0);
});

test("an uncalibrated typer falls back to percent for words and frequency", async ({ page }) => {
  await page.goto(story("uncalibrated-typer"));
  for (const setting of ["words", "numbers", "frequency"]) {
    const tile = row(page, setting).locator('[data-slot="gallery-tile"]');
    await expect(tile).toHaveAttribute("data-wording", "percent");
    await expect(tile.locator('[data-slot="gallery-tile-label"]')).toHaveText("tumor 72%");
    await expect(row(page, setting).locator('[data-slot="ai-call"]')).toHaveText("tumor 72%");
  }
});
