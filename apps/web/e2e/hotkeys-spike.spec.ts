import { expect, type Page, test } from "@playwright/test";

const status = (page: Page) => page.getByRole("status", { name: "Hotkey status" });
const note = (page: Page) => page.getByRole("textbox", { name: "Note" });

test("G then 2 fires outside a text field and types inside one", async ({ page }) => {
  await page.goto("/spikes/hotkeys");
  await expect(status(page)).toBeVisible();
  await page.keyboard.press("g");
  await expect(status(page)).toHaveAttribute("data-pending", "G");
  await page.keyboard.press("2");
  await expect(status(page)).toHaveAttribute("data-last", "Go to AI area 2 press");
  await expect(status(page)).toHaveAttribute("data-pending", "");

  await note(page).focus();
  await page.keyboard.press("g");
  await page.keyboard.press("2");
  await expect(note(page)).toHaveValue("g2");
  await expect(status(page)).toHaveAttribute("data-pending", "");
  await page.keyboard.press("z");
  await expect(note(page)).toHaveValue("g2z");
  await expect(status(page)).toHaveAttribute("data-taps", "0");
  await expect(status(page)).toHaveAttribute("data-holds", "0");

  await page.keyboard.press("Alt+ArrowUp");
  await expect(status(page)).toHaveAttribute("data-last", "Slide brighter press");

  await note(page).blur();
  await page.keyboard.press("g");
  await page.keyboard.press("2");
  await expect(status(page)).toHaveAttribute("data-last", "Go to AI area 2 press");
  await expect(note(page)).toHaveValue("g2z");
});

test("a tap on Z toggles the whole slide and a hold peeks until release", async ({ page }) => {
  await page.goto("/spikes/hotkeys");
  await expect(status(page)).toBeVisible();
  await page.keyboard.press("z");
  await expect(status(page)).toHaveAttribute("data-taps", "1");
  await expect(status(page)).toHaveAttribute("data-peek", "open");
  await page.keyboard.press("z");
  await expect(status(page)).toHaveAttribute("data-peek", "closed");

  await page.keyboard.down("z");
  await expect(status(page)).toHaveAttribute("data-peek", "open");
  await page.waitForTimeout(500);
  await page.keyboard.up("z");
  await expect(status(page)).toHaveAttribute("data-holds", "1");
  await expect(status(page)).toHaveAttribute("data-peek", "closed");

  await note(page).focus();
  await page.keyboard.down("z");
  await page.waitForTimeout(500);
  await page.keyboard.up("z");
  await expect(note(page)).toHaveValue("z");
  await expect(status(page)).toHaveAttribute("data-holds", "1");
  await expect(status(page)).toHaveAttribute("data-peek", "closed");
});
