import { expect, test } from "./a11y.ts";

const listPath = /\/api\/me\/notifications(\?.*)?$/;

test("the bell shows a skeleton at the loaded height while the list is held", async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(listPath, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const skeleton = panel.getByTestId("notifications-skeleton");
  await expect(skeleton).toBeVisible();
  const heldHeight = (await panel.boundingBox())?.height ?? 0;
  release();
  await expect(panel.getByTestId("notification").first()).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  const loadedHeight = (await panel.boundingBox())?.height ?? 0;
  expect(heldHeight).toBeGreaterThan(300);
  expect(Math.abs(heldHeight - loadedHeight)).toBeLessThan(40);
});
