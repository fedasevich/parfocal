import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const fullName = /\b[A-ZÀ-Ž][a-zà-ž]+ (?:[A-ZÀ-Ž][a-zà-ž]+ )?[A-ZÀ-Ž][a-zà-ž]+á\b|Lenka Malá/gu;

async function names(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => {
    const attributes = [...document.querySelectorAll("[title],[aria-label]")].map(
      (node) => `${node.getAttribute("title") ?? ""} ${node.getAttribute("aria-label") ?? ""}`,
    );
    return [document.body.innerText, ...attributes].join("\n");
  });
  return text.match(fullName) ?? [];
}

async function toggle(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Initials only/ }).click();
  await page.keyboard.press("Escape");
}

test("no member name appears in the page with initials only on, and names return when off", async ({
  page,
}) => {
  await page.goto("/team");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => names(page), { timeout: 30_000 }).not.toEqual([]);
  await toggle(page);
  await expect.poll(() => names(page), { timeout: 30_000 }).toEqual([]);

  await toggle(page);
  await expect.poll(() => names(page), { timeout: 30_000 }).not.toEqual([]);
});

test("no member name appears on the comments tab with initials only on", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/comments?slide=${a1}&thread=T2`);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => names(page), { timeout: 30_000 }).not.toEqual([]);
  await toggle(page);
  await expect.poll(() => names(page), { timeout: 30_000 }).toEqual([]);
});
