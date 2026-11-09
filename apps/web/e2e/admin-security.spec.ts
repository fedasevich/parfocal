import { expect, test } from "./a11y.ts";

test("an admin requires two factors for everyone and reads the setting back", async ({ page }) => {
  await page.goto("/admin?section=security");
  const twoFactors = page.getByRole("switch", { name: "Two factors for everyone" });
  await expect(twoFactors).not.toBeChecked();
  await expect(page.getByRole("switch", { name: /single sign-on/i })).toBeDisabled();

  await twoFactors.click();
  await expect(
    page.getByText("Saved. Sign-in does not ask for a second factor yet."),
  ).toBeVisible();
  await expect(twoFactors).toBeChecked();

  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await nav.getByRole("link", { name: "Audit log", exact: true }).click();
  await expect(page).toHaveURL(/section=audit/);
  await nav.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Two factors for everyone" })).toBeChecked();

  await page.getByRole("switch", { name: "Two factors for everyone" }).click();
  await expect(
    page.getByText("Saved. Two factors are no longer required for everyone."),
  ).toBeVisible();
  await expect(page.getByRole("switch", { name: "Two factors for everyone" })).not.toBeChecked();
});

test("the audit log names the members who acted", async ({ page }) => {
  await page.goto("/admin?section=audit");
  await expect(page.getByText("7 events")).toBeVisible();
  await expect(page.getByRole("table").getByText("Daniel Hruška").first()).toBeVisible();
  await expect(page.getByRole("table").getByText("A member")).toHaveCount(0);
});
