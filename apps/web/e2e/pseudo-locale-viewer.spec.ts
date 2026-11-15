import { expect, type Page, test } from "@playwright/test";
import { pseudoLocaleKey } from "../src/i18n/locale.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript((key) => localStorage.setItem(key, "1"), pseudoLocaleKey);
});

async function openFromPrototype(page: Page, name: string | RegExp) {
  const probe = await page.context().newPage();
  await probe.goto("/prototype");
  const link = probe.getByRole("list", { name: "Screens" }).getByRole("link", { name }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = (await link.getAttribute("href")) ?? "";
  await probe.close();
  await page.goto(href);
}

test("the review screen shows no English in the en-XA pseudo locale", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=first`);
  const main = page.locator('main[data-scene="first"]');
  await expect(main).toBeVisible({ timeout: 20_000 });
  await expect(main).not.toContainText("The AI found this. It is outlined in white.");
  await expect(main).not.toContainText("Whole slide");
  await expect(main).not.toContainText("Drag to move around");
});

test("the viewer screen shows no English in the en-XA pseudo locale", async ({ page }) => {
  await openFromPrototype(page, "Full viewer · Objects tab");
  const viewer = page.getByTestId("full-viewer");
  await expect(viewer).toBeVisible({ timeout: 20_000 });
  await expect(viewer).not.toContainText("Objects on");
  await expect(viewer).not.toContainText("Ways to show results");
  await expect(viewer).not.toContainText("Cells in your sample");
});

test("the annotate screen shows no English in the en-XA pseudo locale", async ({ page }) => {
  await openFromPrototype(page, /^Annotate task ·/);
  const viewer = page.getByTestId("full-viewer");
  await expect(viewer).toBeVisible({ timeout: 20_000 });
  await expect(viewer).not.toContainText("on the slide");
  await expect(viewer).not.toContainText("Who made it");
});

test("the compare screen shows no English in the en-XA pseudo locale", async ({ page }) => {
  await openFromPrototype(page, "Full viewer · Objects tab");
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const slides = page.getByRole("dialog");
  await slides.locator('[data-slot="side-by-side"]').first().click();
  await expect(page).toHaveURL(/scene=picked/);
  const viewer = page.getByTestId("full-viewer");
  await expect(viewer).toBeVisible({ timeout: 20_000 });
  await expect(viewer).not.toContainText("Move both together");
  await expect(viewer).not.toContainText("Line up automatically");
  await expect(viewer).not.toContainText("Shared cursor");
});
