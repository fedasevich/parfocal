import { expect, type Page, test } from "./a11y.ts";

const switchMaintenance = (page: Page, method: "PUT" | "DELETE") =>
  page.evaluate(async (chosen) => {
    const response = await fetch("/api/platform/maintenance", {
      method: chosen,
      headers: { "content-type": "application/json" },
      ...(chosen === "PUT"
        ? { body: JSON.stringify({ message: "Database upgrade tonight." }) }
        : {}),
    });
    return response.status;
  }, method);

test("maintenance shows a banner on every shell page until it ends", async ({ page }) => {
  await page.goto("/search");
  const banner = page.getByTestId("maintenance-banner");
  await expect(page.getByRole("textbox", { name: "Search everything" })).toBeVisible();
  await expect(banner).toHaveCount(0);
  expect(await switchMaintenance(page, "PUT")).toBe(200);
  await page.reload();
  await expect(banner).toContainText("Changes are paused");
  await expect(banner).toContainText("Database upgrade tonight.");
  await page.goto("/my-work");
  await expect(banner).toBeVisible();
  expect(await switchMaintenance(page, "DELETE")).toBe(200);
  await page.reload();
  await expect(page.getByTestId("maintenance-banner")).toHaveCount(0);
});
