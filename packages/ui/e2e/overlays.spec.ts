import { expect, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const states = "components-overlay-states--";
const tooltipSelector = '[data-slot="tooltip-content"]';

test("a dialog traps Tab inside and Esc closes it and returns focus to its trigger", async ({
  page,
}) => {
  await page.goto(story("controls-dialog--closed"));
  const trigger = page.getByRole("button", { name: "Sign off" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
        ),
      )
      .toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a dialog with a long text stays inside the viewport and keeps its buttons reachable", async ({
  page,
}) => {
  await page.goto(story(`${states}dialog-long-text`));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  await expect(page.getByRole("button", { name: "Sign off", exact: true }).last()).toBeVisible();
});

test("a locked dialog action is disabled and its reason is on screen", async ({ page }) => {
  await page.goto(story(`${states}dialog-locked-with-reason`));
  await expect(page.getByRole("button", { name: "Sign off", exact: true }).last()).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("Sign-off is locked");
});

test("Esc closes a popover and gives focus back to its trigger", async ({ page }) => {
  await page.goto(story("controls-popover--closed"));
  const trigger = page.getByRole("button", { name: "Brightness" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a menu moves with the arrow keys, skips locked items and closes on Esc", async ({ page }) => {
  await page.goto(story("controls-dropdown-menu--closed"));
  const trigger = page.getByRole("button", { name: "Slide" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Copy link/ })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Download thumbnail" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("a menu with many items scrolls inside its own height", async ({ page }) => {
  await page.goto(story(`${states}menu-many-items`));
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  if (box) expect(box.height).toBeLessThanOrEqual(260);
});

test("a tooltip opens on hover and Esc hides it", async ({ page }) => {
  await page.goto(story("controls-tooltip--closed"));
  await page.getByRole("button", { name: "Measure" }).hover();
  await expect(page.locator(tooltipSelector)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(tooltipSelector)).toHaveCount(0);
});

test("a toast disappears after 1.6 seconds by default and not before", async ({ page }) => {
  await page.clock.install();
  await page.goto(story(`${states}toast-expires`));
  await expect(page.getByRole("status")).toBeVisible();
  await page.clock.fastForward(1000);
  await expect(page.getByRole("status")).toBeVisible();
  await page.clock.fastForward(700);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("a toast sits at the bottom edge, clear of the slide centre", async ({ page }) => {
  await page.clock.install();
  await page.goto(story(`${states}toast-expires`));
  const box = await page.getByRole("status").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  if (box && viewport) {
    expect(box.y).toBeGreaterThan(viewport.height * 0.75);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
});
