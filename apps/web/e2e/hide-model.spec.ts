import { expect, type Page, test } from "./a11y.ts";

const runModel = (page: Page) => page.getByRole("dialog", { name: "Run a model" });

async function openRunModel(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  await palette.getByRole("combobox").fill("Run a model");
  await expect(palette.getByRole("option").first()).toHaveText(/Run a model/);
  await page.keyboard.press("Enter");
  await expect(runModel(page)).toBeVisible();
  await runModel(page)
    .getByRole("button", { name: /PathoSAM \+ HoVer-NeXt/ })
    .click();
  return page.getByRole("listbox", { name: "Models" });
}

test("a hidden Parfocal model leaves Run a model", async ({ page }) => {
  await page.goto("/admin?section=models");
  const camelyon = page.getByRole("switch", { name: "Show CAMELYON tumor model" });
  await expect(camelyon).toBeChecked();
  await camelyon.click();
  await expect(camelyon).not.toBeChecked();
  await expect(
    page.getByText("CAMELYON tumor model is hidden from every model list"),
  ).toBeVisible();

  const models = await openRunModel(page);
  await expect(models.getByRole("option")).toHaveCount(3);
  await expect(models).not.toContainText("CAMELYON tumor model");
  await expect(models).toContainText("HoVer-Net");
});

test("Undo shows the model in every model list again", async ({ page }) => {
  await page.goto("/admin?section=models");
  const camelyon = page.getByRole("switch", { name: "Show CAMELYON tumor model" });
  await camelyon.click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(camelyon).toBeChecked();

  const models = await openRunModel(page);
  await expect(models.getByRole("option")).toHaveCount(4);
  await expect(models).toContainText("CAMELYON tumor model");
});
