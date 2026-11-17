import { expect, test } from "./a11y.ts";

test("an admin creates a token, sees it once and revokes it", async ({ page }) => {
  await page.goto("/admin?section=api");
  await expect(page.getByText("(mock)")).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Add result sets to P07/ })).toBeVisible();

  await page.getByRole("button", { name: "New token" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create token" }).click();
  await expect(dialog.getByText("Name the pipeline that uses the token").first()).toBeVisible();

  await dialog.getByRole("textbox", { name: "Name" }).fill("Nightly scanner export");
  await dialog.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByRole("dialog", { name: "Copy the token now" })).toBeVisible();
  await expect(page.getByTestId("issued-token")).toHaveText(/^pf_/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("issued-token")).toHaveCount(0);

  const row = page.getByRole("row", { name: /Nightly scanner export/ });
  await expect(row).toContainText("See slides, Upload slides and results");
  await expect(row).toContainText("Never");
  await page.getByRole("button", { name: "Revoke the token for Nightly scanner export" }).click();
  await expect(page.getByText("Token revoked. Pipelines using it stop at once.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Nightly scanner export/ })).toHaveCount(0);
});

test("webhooks in and event targets out are listed per project", async ({ page }) => {
  await page.goto("/admin?section=api");
  await expect(page.getByRole("heading", { name: "Webhooks in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event targets out" })).toBeVisible();
  await expect(page.getByRole("row", { name: /P07 incoming/ })).toContainText("1 rejected");
  await expect(page.getByRole("row", { name: /ml\.cuailab\.example/ })).toContainText("Working");
});
