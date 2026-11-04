import { expect, type Page, test } from "@playwright/test";

const open = (page: Page, name: string) =>
  page.goto(
    `/iframe.html?id=components-visualize--${name}&viewMode=story&globals=a11y.manual:!true`,
  );

test("each row shows its colour swatch, version line and date", async ({ page }) => {
  await open(page, "result-sets-toggle");
  const rows = page.locator('[data-slot="result-set-rows"] > div');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Imported 12 Oct");
  await expect(rows.nth(1)).toContainText("Run here 13 Oct");
  await expect(rows.nth(2)).toContainText("Your review");
  await expect(rows.nth(1).locator("i")).toHaveCSS("background-color", "rgb(163, 230, 53)");
});

test("the switch shows and hides a set", async ({ page }) => {
  await open(page, "result-sets-toggle");
  const sam = page.getByRole("switch", { name: "PathoSAM + HoVer-NeXt v1.2" });
  const shown = page.getByTestId("shown");
  await expect(sam).not.toBeChecked();
  await expect(shown).toHaveText("reviewed");
  await sam.click();
  await expect(sam).toBeChecked();
  await expect(shown).toHaveText("sam,reviewed");
  await sam.click();
  await expect(shown).toHaveText("reviewed");
  await page.getByRole("switch", { name: "Your review" }).click();
  await expect(shown).toHaveText("");
});

test("the task set is fixed and has no switch", async ({ page }) => {
  await open(page, "result-sets-toggle");
  await expect(page.getByRole("switch")).toHaveCount(2);
});

test("a row menu offers compare, run again and add another", async ({ page }) => {
  await open(page, "result-sets-toggle");
  await page.getByRole("button", { name: "More for CAMELYON tumor model v1.0" }).click();
  await expect(page.getByRole("menuitem", { name: "Compare with another set" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Run a model on this slide" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Add another result set" })).toBeVisible();
});

test("a locked group is read-only and shows the reason", async ({ page }) => {
  await open(page, "result-sets-locked");
  const group = page.locator('[data-slot="result-set-rows"]');
  await expect(group).toContainText("Locked by RT-14: the other sets stay hidden this round");
  await expect(group.getByRole("switch", { name: "PathoSAM + HoVer-NeXt v1.2" })).toHaveCount(0);
  await expect(group).toContainText("Hidden");
  await expect(group.getByRole("switch", { name: "Your review" })).toBeChecked();
});
