import { expect, test } from "@playwright/test";

test("home opens on the scenario's fake data with the badge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Lenka Malá");
  await expect(page.getByTestId("fake-data-badge")).toHaveText("Fake data");
  await expect(page.getByRole("region", { name: "your jobs" })).toContainText(
    "CAMELYON tumor model v1.0",
  );
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.scriptURL ?? null;
  });
  expect(worker).toMatch(/\/mockServiceWorker\.js$/);
  await page.getByRole("link", { name: "P07 · Sentinel node AI evaluation" }).click();
  await expect(page.getByTestId("project-name")).toHaveText("P07 · Sentinel node AI evaluation");
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\?tab=slides$/);
});

test("the prototype index links to every screen", async ({ page }) => {
  await page.goto("/prototype");
  const screens = page.getByRole("list", { name: "Screens" });
  await expect(screens.getByRole("link")).toHaveCount(11);
  await screens.getByRole("link", { name: "Slide · S26-04812 A1" }).click();
  await expect(page.getByRole("heading", { name: "Slide" })).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get("object")).toBe("T2·C145");
  await page.goBack();
  await screens.getByRole("link", { name: "Settings · profile" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
});

test("a settings deep link to an unknown section is not found", async ({ page }) => {
  await page.goto("/settings/nowhere");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
