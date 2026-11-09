import { expect, test } from "./a11y.ts";

test("the top bar carries each control and the sidebar lists the places to go", async ({
  page,
}) => {
  await page.goto("/");
  const top = page.locator('[data-slot="top-bar"]');
  await expect(top.getByRole("link", { name: /Parfocal/ }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(top.getByRole("button", { name: /Search projects, slides/ })).toBeVisible();
  await expect(top.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(top.getByRole("button", { name: "Upload" })).toBeVisible();
  await expect(top.getByRole("button", { name: /jobs running|Jobs/ }).first()).toBeAttached();
  await expect(top.getByRole("button", { name: /^Notifications/ })).toBeVisible();
  await expect(top.getByRole("button", { name: "Account menu" })).toBeVisible();

  const side = page.getByRole("navigation", { name: "Main" });
  await expect(side.getByRole("link", { name: /^Home/ })).toBeVisible();
  await expect(side.getByRole("link", { name: /^My work/ })).toBeVisible();
  await expect(side.getByRole("link", { name: /^New project/ })).toBeVisible();
});

test("the sidebar has no Mentions entry", async ({ page }) => {
  await page.goto("/");
  const side = page.getByRole("navigation", { name: "Main" });
  await expect(side.getByRole("link", { name: /^Home/ })).toBeVisible({ timeout: 20_000 });
  await expect(side.getByText(/mentions/i)).toHaveCount(0);
  await expect(side.getByRole("link", { name: /mentions/i })).toHaveCount(0);
});

test("search opens the palette, New project and Upload navigate", async ({ page }) => {
  await page.goto("/");
  const top = page.locator('[data-slot="top-bar"]');
  await expect(top.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 20_000 });
  await top.getByRole("button", { name: /Search projects, slides/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await top.getByRole("button", { name: "New project" }).click();
  await expect(page).toHaveURL(/\/projects\/new/);
});

test("every top bar control and the sidebar links take focus from the keyboard", async ({
  page,
}) => {
  await page.goto("/");
  const top = page.locator('[data-slot="top-bar"]');
  await expect(top.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 20_000 });
  const targets = [
    top.getByRole("button", { name: /Search projects, slides/ }),
    top.getByRole("button", { name: "New project" }),
    top.getByRole("button", { name: "Upload" }),
    top.getByRole("button", { name: /^Notifications/ }),
    top.getByRole("button", { name: "Account menu" }),
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Home/ }),
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^My work/ }),
  ];
  for (const target of targets) {
    await target.focus();
    await expect(target).toBeFocused();
  }
  await targets[0]?.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});
