import { expect, test } from "@playwright/test";
import { hasPlainLetters, pseudoLocaleKey } from "../src/i18n/locale.ts";

const converted = [
  { path: "/issue-pages/not-found", testId: "issue-not-found", english: "Page not found" },
  { path: "/issue-pages/expired", testId: "issue-session-expired", english: "Your session ended" },
];

for (const screen of converted) {
  test(`${screen.path} shows no plain letters in the en-XA pseudo locale`, async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), pseudoLocaleKey);
    await page.goto(screen.path);
    const main = page.getByTestId(screen.testId);
    await expect(main).toBeVisible();
    await expect(main).not.toContainText(screen.english);
    const text = await main.innerText();
    expect(text.trim().length).toBeGreaterThan(20);
    expect(hasPlainLetters(text), text).toBe(false);
  });

  test(`${screen.path} reads in English by default`, async ({ page }) => {
    await page.goto(screen.path);
    await expect(page.getByTestId(screen.testId)).toContainText(screen.english);
  });
}
