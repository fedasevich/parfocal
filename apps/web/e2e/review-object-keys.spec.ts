import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 120_000 });

const panel = (page: Page) => page.getByTestId("stage-review-objects");

async function openGuided(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  await expect(panel(page)).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  await page.getByRole("button", { name: "Got it, start" }).click();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

const at = async (page: Page) => (await panel(page).getAttribute("data-current")) ?? "";

async function positionOf(page: Page): Promise<{ place: number; total: number }> {
  const line = await panel(page)
    .getByText(/^Object \d+ of \d+ on this slide$/)
    .innerText();
  const [place = 0, total = 0] = (line.match(/\d+/g) ?? []).map(Number);
  return { place, total };
}

async function press(page: Page, key: "j" | "Shift+j", expectedPlace: number) {
  await page.keyboard.press(key);
  await expect(panel(page).getByText(`Object ${expectedPlace} of`, { exact: false })).toBeVisible();
  return at(page);
}

test("J and Shift+J walk the objects in list order and stop at the first one", async ({ page }) => {
  await openGuided(page);
  const { place, total } = await positionOf(page);
  expect(total).toBeGreaterThan(5);
  const seen = new Map<number, string>([[place, await at(page)]]);
  for (let step = place + 1; step <= total; step += 1) {
    seen.set(step, await press(page, "j", step));
  }
  expect(new Set(seen.values()).size).toBe(seen.size);
  for (let step = total - 1; step >= place; step -= 1) {
    expect(await press(page, "Shift+j", step)).toBe(seen.get(step) ?? "");
  }
  for (let step = place - 1; step >= 1; step -= 1) await press(page, "Shift+j", step);
  await page.keyboard.press("Shift+j");
  expect(await positionOf(page)).toEqual({ place: 1, total });
  await expect(panel(page).getByRole("button", { name: /Previous/ })).toBeDisabled();
});

test("J and Shift+J still step after a decision", async ({ page }) => {
  await openGuided(page);
  const first = await at(page);
  await page.keyboard.press("k");
  await expect(panel(page)).not.toHaveAttribute("data-current", first);
  const landed = await at(page);
  const { place } = await positionOf(page);
  const after = await press(page, "j", place + 1);
  expect(after).not.toBe(landed);
  expect(await press(page, "Shift+j", place)).toBe(landed);
  await press(page, "Shift+j", place - 1);
});

test("J and Shift+J step while a disagreement is open, and after a fix toast", async ({ page }) => {
  await openGuided(page);
  const start = await at(page);
  const { place } = await positionOf(page);
  await page.keyboard.press("x");
  await expect(panel(page).getByRole("button", { name: "Change the type" })).toBeVisible();
  await press(page, "j", place + 1);
  expect(await press(page, "Shift+j", place)).toBe(start);
  await panel(page).getByRole("button", { name: "Change the type" }).click();
  await page
    .getByRole("button", { name: /Lymphocyte|Stroma|Tumor/ })
    .first()
    .click();
  await expect(page.getByText(/The AI result is not changed/)).toBeVisible();
  await press(page, "j", place + 1);
  expect(await press(page, "Shift+j", place)).toBe(start);
});

test("J and Shift+J step while an outline edit is open", async ({ page }) => {
  await openGuided(page);
  const start = await at(page);
  const { place } = await positionOf(page);
  await panel(page)
    .getByTestId("object-fix-row")
    .getByRole("button", { name: /Edit shape/ })
    .click();
  await expect(page.getByTestId("outline-editor")).toHaveAttribute("data-editing", start);
  await press(page, "j", place + 1);
  await expect(page.getByTestId("outline-editor")).toHaveCount(0);
  expect(await press(page, "Shift+j", place)).toBe(start);
  await panel(page)
    .getByTestId("object-fix-row")
    .getByRole("button", { name: /Edit shape/ })
    .click();
  await expect(page.getByTestId("outline-editor")).toHaveAttribute("data-editing", start);
  await press(page, "Shift+j", place - 1);
  await expect(page.getByTestId("outline-editor")).toHaveCount(0);
});

test("J and Shift+J step while the brush is open", async ({ page }) => {
  await openGuided(page);
  const start = await at(page);
  const { place } = await positionOf(page);
  await page.keyboard.press("Enter");
  const bar = panel(page).getByTestId("shape-edit-bar");
  await expect(bar).toHaveAttribute("data-tool", "handles");
  await bar.getByRole("button", { name: "Brush" }).click();
  await expect(bar).toHaveAttribute("data-tool", "brush");
  await press(page, "j", place + 1);
  await expect(bar).toHaveCount(0);
  expect(await press(page, "Shift+j", place)).toBe(start);
  await expect(bar).toHaveCount(0);
});
