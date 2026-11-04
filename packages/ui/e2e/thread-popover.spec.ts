import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const popover = (page: Page) => page.locator('[data-slot="thread-popover"]');

test("the popover shows the title, the measurement and each message with its time", async ({
  page,
}) => {
  await page.goto(story("components-thread-popover--open-thread"));
  await expect(
    page.getByRole("heading", { name: /boundary run past the capsule fold/ }),
  ).toBeVisible();
  const embed = page.locator('[data-slot="thread-measurement"]');
  await expect(embed).toContainText("Tumor region");
  await expect(embed).toContainText("1.82 mm²");
  const comments = page.locator('[data-slot="comment"]');
  await expect(comments).toHaveCount(2);
  await expect(comments.first()).toContainText("25 min ago");
  await expect(comments.nth(1)).toContainText("4 min ago");
  await expect(page.getByRole("button", { name: "Resolve" })).toBeVisible();
});

test("the popover leaves the measurement out when the thread has none", async ({ page }) => {
  await page.goto(story("components-thread-popover--without-measurement"));
  await expect(page.locator('[data-slot="thread-measurement"]')).toHaveCount(0);
});

test("Enter posts a reply and Shift+Enter adds a line", async ({ page }) => {
  await page.goto(story("components-thread-popover--open-thread"));
  const field = page.getByRole("textbox", { name: "Reply to this thread" });
  await expect(page.getByRole("button", { name: /^Reply/ }).last()).toBeDisabled();
  await field.fill("First line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  await expect(field).toHaveValue("First line\nSecond line");
  await page.keyboard.press("Enter");
  const comments = page.locator('[data-slot="comment"]');
  await expect(comments).toHaveCount(3);
  await expect(comments.last()).toContainText("just now");
  await expect(comments.last()).toContainText("Second line");
  await expect(field).toHaveValue("");
});

test("Resolve turns into Reopen and back", async ({ page }) => {
  await page.goto(story("components-thread-popover--open-thread"));
  await page.getByRole("button", { name: "Resolve" }).click();
  await expect(popover(page)).toHaveAttribute("data-resolved", "true");
  await expect(page.getByRole("status")).toContainText("Resolved");
  await page.getByRole("button", { name: "Reopen" }).click();
  await expect(popover(page)).toHaveAttribute("data-resolved", "false");
});

test("Close and Escape both dismiss the popover", async ({ page }) => {
  await page.goto(story("components-thread-popover--open-thread"));
  await page.getByRole("button", { name: "Close thread" }).click();
  await expect(popover(page)).toHaveCount(0);
  await page.goto(story("components-thread-popover--open-thread"));
  await page.getByRole("textbox", { name: "Reply to this thread" }).focus();
  await page.keyboard.press("Escape");
  await expect(popover(page)).toHaveCount(0);
});
