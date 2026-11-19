import { expect, test } from "./a11y.ts";

test("See all opens the full list, pages it and marks everything read", async ({ page }) => {
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const inBell = await panel.getByTestId("notification").count();
  await panel.getByRole("button", { name: "See all" }).click();

  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  const list = page.getByRole("list", { name: "All notifications" });
  await expect(list.getByTestId("notification").first()).toBeVisible();
  const total = await list.getByTestId("notification").count();
  expect(total).toBeGreaterThanOrEqual(inBell);
  expect(total).toBeGreaterThan(6);
  await expect(list.getByRole("img", { name: "Unread" }).first()).toBeVisible();

  await page.goto("/notifications?size=3");
  await expect(list.getByTestId("notification")).toHaveCount(3);
  await page.getByRole("button", { name: "Show older" }).click();
  await expect(list.getByTestId("notification")).toHaveCount(6);
  await page.getByRole("button", { name: "Show older" }).click();
  await expect(list.getByTestId("notification")).toHaveCount(total);
  await expect(page.getByRole("button", { name: "Show older" })).toHaveCount(0);

  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(list.getByRole("img", { name: "Unread" })).toHaveCount(0);
  await expect(list.getByTestId("notification")).toHaveCount(total);
});
