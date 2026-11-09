import { expect, type Page, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

const dialog = (page: Page) => page.getByRole("dialog", { name: "Settings" });

const pick = (page: Page, group: string, name: string) =>
  dialog(page).getByRole("radiogroup", { name: group }).getByRole("radio", { name });

test("theme and density change the interface at once", async ({ page }) => {
  await page.goto("/settings/display");
  const html = page.locator("html");
  await pick(page, "Theme", "Light").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await pick(page, "Theme", "Dark").click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await pick(page, "Density", "Compact").click();
  await expect(html).toHaveAttribute("data-density", "compact");
  await pick(page, "Density", "Comfortable").click();
  await expect(html).toHaveAttribute("data-density", "comfortable");
});

test("slide brightness is remembered on this device at once", async ({ page }) => {
  await page.goto("/settings/display");
  await dialog(page).getByRole("button", { name: "Lower Slide brightness" }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("parfocal.slide-brightness")))
    .toBe("90");
});

test("patient names, lengths and the magnification label are saved and kept", async ({ page }) => {
  await page.goto("/settings/display");
  await pick(page, "Patient names", "Initials only").click();
  await pick(page, "Lengths", "Always µm").click();
  await pick(page, "Magnification label", "µm per pixel").click();
  await expect(pick(page, "Patient names", "Initials only")).toBeChecked();
  await page.reload();
  await expect(pick(page, "Patient names", "Initials only")).toBeChecked();
  await expect(pick(page, "Lengths", "Always µm")).toBeChecked();
  await expect(pick(page, "Magnification label", "µm per pixel")).toBeChecked();
});

test("language shows English and leaves Čeština disabled", async ({ page }) => {
  await page.goto("/settings/display");
  await expect(pick(page, "Language", "English")).toBeChecked();
  await expect(pick(page, "Language", "Čeština")).toBeDisabled();
});
