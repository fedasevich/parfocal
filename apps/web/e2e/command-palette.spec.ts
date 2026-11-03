import { expect, type Page, test } from "@playwright/test";

async function openPalette(page: Page) {
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 500 });
  }).toPass();
  return palette;
}

test("Cmd+K finds an action by loose letters and Enter runs the first result", async ({ page }) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("my wrk");
  const first = palette.getByRole("option").first();
  await expect(first).toHaveText(/Open My work/);
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/my-work$/);
});

test("an object is found by a piece of its path and Enter opens it on the slide", async ({
  page,
}) => {
  await page.goto("/my-work");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("s26-04812 c145");
  await expect(palette.getByRole("option", { name: /C145 on A1/ }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\?.*object=T\d/);
  await expect(page).not.toHaveURL(/open=palette/);
});

test("a setting is found by loose letters, shows its keys and opens its section", async ({
  page,
}) => {
  await page.goto("/");
  const palette = await openPalette(page);
  await palette.getByRole("combobox").fill("bright");
  const row = palette.getByRole("option", { name: /Slide brightness/ });
  await expect(row).toContainText("⌥↑");
  await palette.getByRole("combobox").fill("mswhl");
  await expect(palette.getByRole("option").first()).toHaveText(/Mouse wheel/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\/navigation$/);
});

test("Measure shows only on a slide and arms the ruler", async ({ page }) => {
  await page.goto("/my-work");
  let palette = await openPalette(page);
  await palette.getByRole("combobox").fill("measure");
  await expect(palette.getByRole("option", { name: /^Measure/ })).toHaveCount(0);
  await palette.getByRole("combobox").fill("c145");
  await palette
    .getByRole("option", { name: /C145 on A1/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/slides\//);
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("measure");
  const measure = palette.getByRole("option", { name: /Measure/ });
  await expect(measure).toContainText("L");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/tool=ruler/);
});

test("lab actions appear only once developer mode is on", async ({ page }) => {
  await page.goto("/");
  let palette = await openPalette(page);
  await palette.getByRole("combobox").fill("benchmark");
  await expect(palette.getByRole("option", { name: /^Benchmark/ })).toHaveCount(0);
  await expect(palette.getByText("Lab", { exact: true })).toHaveCount(0);
  await palette.getByRole("combobox").fill("developer mode");
  await expect(palette.getByRole("option").first()).toHaveText(/Turn developer mode on/);
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("benchmark");
  await expect(palette.getByText("Lab", { exact: true })).toBeVisible();
  await expect(palette.getByRole("option").first()).toHaveText(/^Benchmark/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/developer\?.*section=bench/);
  await palette.waitFor({ state: "detached" });
  palette = await openPalette(page);
  await palette.getByRole("combobox").fill("developer mode");
  await expect(palette.getByRole("option").first()).toHaveText(/Turn developer mode off/);
});
