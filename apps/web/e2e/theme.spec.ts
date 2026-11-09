import { expect, test } from "./a11y.ts";

const html = (page: import("@playwright/test").Page) => page.locator("html");
test.describe.configure({ timeout: 90_000 });

test("with no stored choice the theme follows the device and changes with it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-theme", "light", { timeout: 20_000 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html(page)).toHaveAttribute("data-theme", "dark");
});

test("a chosen theme is kept on this device and the old key moves into the device layer", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded") === null) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("parfocal-theme", "light");
    }
  });
  await page.goto("/");
  await expect(html(page)).toHaveAttribute("data-theme", "light", { timeout: 20_000 });
  const stored = await page.evaluate(() => ({
    old: localStorage.getItem("parfocal-theme"),
    device: localStorage.getItem("parfocal.device-settings"),
  }));
  expect(stored).toEqual({ old: null, device: '{"theme":"light"}' });
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "light", { timeout: 20_000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() =>
    localStorage.setItem("parfocal.device-settings", JSON.stringify({ theme: "dark" })),
  );
  await page.reload();
  await expect(html(page)).toHaveAttribute("data-theme", "dark", { timeout: 20_000 });
});
