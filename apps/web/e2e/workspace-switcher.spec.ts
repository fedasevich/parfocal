import { expect, type Page, test } from "@playwright/test";

const switcher = (page: Page) => page.locator('[data-slot="workspace-switch"]');

test("switching workspace reloads My work in the new workspace", async ({ page }) => {
  await page.goto("/my-work?tab=review");
  await expect(switcher(page)).toContainText("Fakultní nemocnice Vltava");
  await expect(page.getByText("Continue reviewing")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toContainText("Sentinel node");

  await switcher(page).click();
  const switched = page.waitForRequest(
    (request) => request.method() === "PUT" && request.url().endsWith("/api/me/workspace"),
  );
  await page.getByRole("menuitem", { name: /Charles University AI Lab/ }).click();
  expect((await switched).postDataJSON()).toEqual({ tenant_id: expect.any(String) });

  await expect(switcher(page)).toContainText("Charles University AI Lab");
  await expect(page).toHaveURL(/\/my-work/);
  await expect(page.getByText("Nothing to review. New tasks show here.")).toBeVisible();
  await expect(page.getByText("Continue reviewing")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main" })).not.toContainText("Sentinel node");

  await switcher(page).click();
  await page.getByRole("menuitem", { name: /Fakultní nemocnice Vltava/ }).click();
  await expect(page.getByText("Continue reviewing")).toBeVisible();
});

test("switching workspace from a project page goes home", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: /Sentinel node/ })
    .click();
  await expect(page).toHaveURL(/\/projects\//);
  await switcher(page).click();
  await page.getByRole("menuitem", { name: /Charles University AI Lab/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(switcher(page)).toContainText("Charles University AI Lab");
});

test("a refused switch keeps the workspace and says why in a toast", async ({ page }) => {
  await page.goto("/my-work?tab=review&suspended=cu-ai-lab");
  await expect(page.getByText("Continue reviewing")).toBeVisible();
  await switcher(page).click();
  await page.getByRole("menuitem", { name: /Charles University AI Lab/ }).click();
  const toast = page.getByRole("alert").filter({ hasText: "You do not have access" });
  await expect(toast).toBeVisible();
  await expect(switcher(page)).toContainText("Fakultní nemocnice Vltava");
  await expect(page.getByText("Continue reviewing")).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toBeHidden();
});

test("admin's top bar switches workspace too", async ({ page }) => {
  await page.goto("/admin?section=people");
  await expect(switcher(page)).toContainText("Fakultní nemocnice Vltava");
  await switcher(page).click();
  await page.getByRole("menuitem", { name: /Charles University AI Lab/ }).click();
  await expect(switcher(page)).toContainText("Charles University AI Lab");
  await expect(page).toHaveURL(/\/admin/);
});
