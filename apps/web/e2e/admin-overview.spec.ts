import { expect, test } from "./a11y.ts";

test("the overview shows the stat tiles and a short summary per section from seeded data", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText("3 invites waiting")).toBeVisible();
  await expect(page.getByText(/runs going now/)).toBeVisible();
  await expect(page.getByText(/^Stored, of /)).toBeVisible();
  await expect(page.getByText("Webhook calls today")).toBeVisible();
  for (const title of ["People and roles", "AI models", "Storage and sources", "Recent activity"]) {
    await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Researchers who also set up this page")).toBeVisible();
  await expect(page.getByText("Rejected a call with a bad signature")).toBeVisible();
});

test("the storage summary shows the compact split bar and a link opens the audit log", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page.locator("[data-slot=storage-bar]").first()).toBeVisible();
  await expect(page.locator("[data-slot=storage-bar]").getByRole("img").first()).toBeVisible();
  await page.getByRole("button", { name: "Audit log" }).last().click();
  await expect(page).toHaveURL(/section=audit/);
});
