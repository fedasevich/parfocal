import type { Locator } from "@playwright/test";
import { expect, test } from "./a11y.ts";

type Box = { x: number; y: number; width: number; height: number } | null;

async function settledBox(panel: Locator): Promise<Box> {
  let previous = await panel.boundingBox();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await panel.page().waitForTimeout(100);
    const next = await panel.boundingBox();
    if (JSON.stringify(next) === JSON.stringify(previous)) return next;
    previous = next;
  }
  return previous;
}

test("the bell skeleton has the box and row count of the loaded popover", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, { releaseNotifications: () => release() });
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
      if (new URL(url, location.href).pathname.endsWith("/api/me/notifications")) await held;
      return original(input, init);
    };
  });
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const skeleton = panel.getByTestId("notifications-skeleton");
  await expect(skeleton).toBeVisible();
  const heldBox = await settledBox(panel);
  const heldRows = await panel.getByTestId("notifications-skeleton-row").count();
  await page.evaluate(() =>
    (window as unknown as { releaseNotifications: () => void }).releaseNotifications(),
  );
  await expect(panel.getByTestId("notification").first()).toBeVisible();
  await expect(skeleton).toHaveCount(0);
  const loadedBox = await settledBox(panel);
  const loadedRows = await panel.getByTestId("notification").count();
  expect(heldBox).not.toBeNull();
  expect(loadedBox).not.toBeNull();
  expect(Math.abs((heldBox?.width ?? 0) - (loadedBox?.width ?? 1))).toBeLessThanOrEqual(4);
  expect(Math.abs((heldBox?.height ?? 0) - (loadedBox?.height ?? 1))).toBeLessThanOrEqual(4);
  expect(Math.abs((heldBox?.x ?? 0) - (loadedBox?.x ?? 1))).toBeLessThanOrEqual(4);
  expect(Math.abs((heldBox?.y ?? 0) - (loadedBox?.y ?? 1))).toBeLessThanOrEqual(4);
  expect(heldRows).toBe(5);
  expect(loadedRows).toBe(heldRows);
});

test("every notification row names its task or object", async ({ page }) => {
  await page.goto("/my-work");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const rows = panel.getByTestId("notification");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    await expect(rows.nth(index).locator("small")).toHaveText(/\S/);
  }
});
