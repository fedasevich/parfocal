import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;

test("the switcher lists the workspaces by organisation and marks the active one", async ({
  page,
}) => {
  await page.goto(story("shell-workspace-switcher--closed"));
  await page.getByRole("button", { name: /Fakultní nemocnice Vltava/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("group", { name: "FN Vltava" }).getByRole("menuitem")).toHaveCount(2);
  await expect(menu.getByRole("group", { name: "Charles University" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Fakultní nemocnice Vltava/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("picking another workspace selects it and shows it on the button", async ({ page }) => {
  await page.goto(story("shell-workspace-switcher--closed"));
  await page.getByRole("button", { name: /Fakultní nemocnice Vltava/ }).click();
  await page.getByRole("menuitem", { name: /Charles University AI Lab/ }).click();
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(page.getByRole("status", { name: "Active workspace" })).toHaveText("cu-ai-lab");
  await expect(page.locator('[data-slot="workspace-switch"]')).toContainText(
    "Charles University AI Lab",
  );
});

test("while a switch is under way no workspace can be picked", async ({ page }) => {
  await page.goto(story("shell-workspace-switcher--switching"));
  await expect(page.getByRole("menuitem", { name: /FN Vltava diagnostics/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});
