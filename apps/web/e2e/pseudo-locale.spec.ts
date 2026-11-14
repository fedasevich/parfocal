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

const screens = [
  {
    name: "settings",
    path: "/settings/display",
    english: ["Slide brightness", "Density", "Patient names", "Magnification label"],
  },
  {
    name: "admin",
    path: "/admin",
    english: ["at a glance", "Audit log", "Invite people"],
  },
  {
    name: "home",
    path: "/",
    english: [
      "Review the first slide",
      "Open the project",
      "Nothing here counts in a real evaluation",
    ],
  },
];

for (const screen of screens) {
  test(`the ${screen.name} screen shows no English in the en-XA pseudo locale`, async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, "1"), pseudoLocaleKey);
    await page.goto(screen.path);
    const main = page.locator("main").first();
    await expect(main).toBeVisible({ timeout: 20_000 });
    for (const phrase of screen.english) await expect(main).not.toContainText(phrase);
  });
}

test("the shell shows no English in the en-XA pseudo locale", async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, "1"), pseudoLocaleKey);
  await page.goto("/settings/display");
  await expect(page.locator("main").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Notifications/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry now" })).toHaveCount(0);
});
