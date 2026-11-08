import { expect, type Page, test } from "@playwright/test";

async function displayScene(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Visualize · Display panel, the task default" });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

const regionPaths = (page: Page) => page.locator('[data-slot="slide-still"] svg > path');

const row = (page: Page, label: string) =>
  page.locator('[data-slot="control-row"]').filter({ hasText: label });

async function pick(page: Page, label: string, option: string) {
  await row(page, label).getByRole("radio", { name: option }).click();
}

test("draw as, width and colour change how the regions draw", async ({ page }) => {
  await displayScene(page);
  const first = regionPaths(page).first();
  await expect(first).toHaveAttribute("fill", "none");
  await pick(page, "Draw as", "Fill");
  await expect(first).not.toHaveAttribute("fill", "none");
  await pick(page, "Draw as", "Outline");
  await expect(first).toHaveAttribute("fill", "none");
  await pick(page, "Width", "3 px");
  await expect(first).toHaveAttribute("stroke-width", "3");
  await pick(page, "Width", "1 px");
  await expect(first).toHaveAttribute("stroke-width", "1");
  const byClass = await first.getAttribute("stroke");
  await pick(page, "Color by", "Score");
  await expect(first).not.toHaveAttribute("stroke", byClass ?? "");
  await expect(first).toHaveAttribute("stroke", /^rgb\(/);
  await pick(page, "Color by", "Decision");
  await expect(first).not.toHaveAttribute("stroke", /^rgb\(\d+ \d+ \d+\)$/);
});

test("opacity fades the objects", async ({ page }) => {
  await displayScene(page);
  const first = regionPaths(page).first();
  const slider = page.getByRole("slider", { name: "Opacity" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(first).toHaveAttribute("stroke-opacity", "0.2");
  await page.keyboard.press("End");
  await expect(first).toHaveAttribute("stroke-opacity", "1");
});

test("the score cutoff draws low objects dashed and faint without changing what is in scope", async ({
  page,
}) => {
  await displayScene(page);
  const regions = regionPaths(page);
  const before = await regions.count();
  const rows = page.getByRole("complementary", { name: "Side panel" });
  await page.getByRole("tab", { name: /Objects/ }).click();
  const listed = await rows.getByText(/^T\d/).count();
  await page.getByRole("tab", { name: "Display" }).click();
  const slider = page.getByRole("slider", { name: "Score cutoff" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(regions.first()).not.toHaveAttribute("stroke-dasharray", /.+/);
  await page.keyboard.press("End");
  await expect(regions.first()).toHaveAttribute("stroke-dasharray", "6 4");
  await expect(regions.first()).toHaveAttribute("stroke-opacity", "0.5");
  await expect(regions).toHaveCount(before);
  await page.getByRole("tab", { name: /Objects/ }).click();
  await expect(rows.getByText(/^T\d/)).toHaveCount(listed);
});

test("a class can be hidden with its switch or its key and shows its count", async ({ page }) => {
  await displayScene(page);
  const classes = page.locator('[data-slot="class-visibility"]');
  const tumor = classes.locator('[data-class="Tumor"]');
  await expect(tumor).toContainText(/\d/);
  const before = await regionPaths(page).count();
  const toggle = classes.getByRole("switch", { name: "Show Tumor" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => regionPaths(page).count()).toBeLessThan(before);
  await toggle.focus();
  await page.keyboard.press("1");
  await expect(toggle).toBeChecked();
  await expect(regionPaths(page)).toHaveCount(before);
});

test("confidence shows as a number, a word, a colour or nothing", async ({ page }) => {
  await displayScene(page);
  const chip = page.locator('[data-slot="confidence-chip"]');
  const viewer = page.getByTestId("full-viewer");
  const showOnObject = async (form: string) => {
    await page.getByRole("tab", { name: "Display" }).click();
    await pick(page, "Confidence", form);
    await page.getByRole("tab", { name: /Objects/ }).click();
  };
  await showOnObject("Color");
  await page.getByRole("button", { name: /^T\d/ }).first().click();
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute("data-band", /confident|likely|unsure|doubtful/);
  await showOnObject("Number");
  await expect(chip).toHaveCount(0);
  await expect(viewer).toContainText(/\d+% sure/);
  await showOnObject("Hidden");
  await expect(chip).toHaveCount(0);
  await expect(viewer).not.toContainText(/\d+% sure/);
});
