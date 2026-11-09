import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const tools: { keys: string; label: string; hints: number; strip: boolean }[] = [
  { keys: "v", label: "Select", hints: 3, strip: false },
  { keys: "s", label: "Smart select", hints: 4, strip: true },
  { keys: "p", label: "Polygon", hints: 3, strip: true },
  { keys: "Shift+P", label: "Freehand", hints: 2, strip: true },
  { keys: "r", label: "Rectangle", hints: 2, strip: true },
  { keys: "o", label: "Ellipse", hints: 2, strip: true },
  { keys: "m", label: "Count marker", hints: 2, strip: true },
  { keys: "l", label: "Ruler", hints: 3, strip: false },
  { keys: "Shift+L", label: "Arrow", hints: 1, strip: false },
  { keys: "t", label: "Text", hints: 2, strip: false },
  { keys: "c", label: "Comment", hints: 2, strip: false },
  { keys: "b", label: "Brush", hints: 3, strip: true },
];

async function openSlide(page: import("@playwright/test").Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  return stage;
}

test("one context bar shows the active tool's hints and the class strip where a tool needs it", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const bar = page.getByTestId("context-bar");
  await expect(bar).toHaveCount(1);

  for (const item of tools) {
    await page.keyboard.press(item.keys);
    await expect(bar).toHaveAttribute("aria-label", `${item.label} options`);
    await expect(bar.locator('[data-slot="context-pill"]')).toHaveCount(item.hints);
    if (item.strip) await expect(page.getByTestId("class-strip")).toBeVisible();
    else await expect(page.getByTestId("class-strip")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(stage).toHaveAttribute("data-tool", "select");
  }
});

test("the class keys and the swatches pick the same class across tools", async ({ page }) => {
  await openSlide(page);
  await page.keyboard.press("p");
  const swatches = page.getByTestId("class-swatch");
  await expect(swatches.nth(1)).toBeVisible();
  await expect(swatches.nth(0)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("2");
  await expect(swatches.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(swatches.nth(0)).toHaveAttribute("aria-pressed", "false");

  await swatches.nth(0).click();
  await expect(swatches.nth(0)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("m");
  await expect(swatches.nth(0)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("2");
  await expect(page.getByTestId("context-bar")).toContainText("Class 2");
});
