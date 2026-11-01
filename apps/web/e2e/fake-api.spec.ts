import { expect, test } from "@playwright/test";

test("home opens on the scenario's fake data with the badge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good afternoon, Lenka" })).toBeVisible();
  await expect(page.getByTestId("fake-data-badge")).toHaveText("Fake data");
  await expect(page.getByRole("button", { name: "Jobs, 2 running" })).toBeVisible();
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.scriptURL ?? null;
  });
  expect(worker).toMatch(/\/mockServiceWorker\.js$/);
  await page.getByRole("button", { name: /^Sentinel node AI evaluation P07/ }).click();
  await expect(page.getByRole("heading", { name: "Sentinel node AI evaluation" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\?tab=slides$/);
});

test("the prototype index links to every screen", async ({ page }) => {
  await page.goto("/prototype");
  const screens = page.getByRole("list", { name: "Screens" });
  await expect(screens.getByRole("link")).toHaveCount(168);
  await screens.getByRole("link", { name: "Slide · S26-04812 A1" }).click();
  await expect(page.getByRole("heading", { name: "Slide" })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("object")).toBe("T2·C145");
  await page.goBack();
  await screens.getByRole("link", { name: "Shortcuts · key already used" }).click();
  await expect(page).toHaveURL(/\/settings\/shortcuts\?scene=conflict$/);
});

test("a settings deep link to an unknown section is not found", async ({ page }) => {
  await page.goto("/settings/nowhere");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
