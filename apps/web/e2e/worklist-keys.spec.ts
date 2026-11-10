import { expect, type Locator, type Page, test } from "./a11y.ts";

const picked = (rows: Locator) =>
  rows.and(rows.page().locator("[aria-selected='true'], [aria-pressed='true']"));

async function names(rows: Locator) {
  return (await rows.allInnerTexts()).map((text) => text.split("\n")[0]?.trim() ?? "");
}

async function press(page: Page, ...keys: string[]) {
  for (const key of keys) await page.keyboard.press(key);
}

test("To review moves with the arrows and J and K, Esc clears and Enter opens the task", async ({
  page,
}) => {
  await page.goto("/my-work?tab=review");
  const rows = page.getByRole("list", { name: "Your tasks" }).locator("[data-list-row]");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const count = await rows.count();
  await expect(picked(rows)).toHaveCount(0);
  await press(page, "j");
  await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/sel=/);
  for (let step = 1; step < count; step++) {
    await press(page, step % 2 ? "ArrowDown" : "J");
    await expect(rows.nth(step)).toHaveAttribute("aria-pressed", "true");
  }
  await press(page, "j");
  await expect(rows.nth(count - 1)).toHaveAttribute("aria-pressed", "true");
  await press(page, "k");
  await expect(rows.nth(Math.max(0, count - 2))).toHaveAttribute("aria-pressed", "true");
  await press(page, "Escape");
  await expect(picked(rows)).toHaveCount(0);
  await expect(page).not.toHaveURL(/sel=/);
  await press(page, "ArrowUp");
  await expect(rows.nth(count - 1)).toHaveAttribute("aria-pressed", "true");
  await press(page, "Enter");
  await expect(page).toHaveURL(/\/tasks\/[^/]+\/guided/);
});

test("Assigned by me selects with the keys and Enter opens what the task waits for", async ({
  page,
}) => {
  await page.goto("/my-work?tab=assigned");
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await press(page, "ArrowDown");
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");
  const target = await rows.evaluateAll((all) =>
    all.findIndex((row) => row.textContent?.includes("Resolve")),
  );
  expect(target).toBeGreaterThanOrEqual(0);
  for (let step = 0; step < target; step++) await press(page, "j");
  await expect(rows.nth(target)).toHaveAttribute("aria-selected", "true");
  await press(page, "Escape");
  await expect(picked(rows)).toHaveCount(0);
  await press(page, "j");
  for (let step = 0; step < target; step++) await press(page, "j");
  await press(page, "Enter");
  await expect(page).toHaveURL(/\/tasks\/[^/]+\/disagreements$/);
});

test("All slides walks the table with the preview following and Enter opens the slide", async ({
  page,
}) => {
  await page.goto("/my-work?tab=all");
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(7);
  const labels = await names(rows);
  await press(page, "ArrowDown");
  await expect(page.getByRole("complementary", { name: `Preview of ${labels[0]}` })).toBeVisible();
  await press(page, "j", "j");
  await expect(page.getByRole("complementary", { name: `Preview of ${labels[2]}` })).toBeVisible();
  await press(page, "K");
  await expect(page.getByRole("complementary", { name: `Preview of ${labels[1]}` })).toBeVisible();
  await press(page, "Escape");
  await expect(page.getByRole("complementary", { name: /Preview of/ })).toHaveCount(0);
  await press(page, "k");
  await expect(rows.nth(6)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("textbox", { name: "Find a slide, case or ID" }).focus();
  await press(page, "ArrowUp");
  await expect(rows.nth(6)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("textbox", { name: "Find a slide, case or ID" }).blur();
  await press(page, "Enter");
  await expect(page).toHaveURL(/\/projects\/[^/]+\/slides\//);
});
