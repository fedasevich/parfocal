import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
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

test("tool hints close with their button or key, stay closed after a reload and come back from Help", async ({
  page,
}) => {
  test.slow();
  const stage = await openSlide(page);
  const bar = page.getByTestId("context-bar");
  const pills = bar.locator('[data-slot="context-pill"]');

  await page.keyboard.press("r");
  await expect(bar).toHaveAttribute("aria-label", "Rectangle options");
  await expect(pills).toHaveCount(2);
  await bar.getByTestId("hint-close").click();
  await expect(pills).toHaveCount(0);
  await expect(page.getByTestId("class-strip")).toBeVisible();

  await page.keyboard.press("s");
  await expect(bar).toHaveAttribute("aria-label", "Smart select options");
  await expect(pills).toHaveCount(3);
  await expect(bar.getByTestId("smart-hover-toggle")).toBeVisible();
  await page.keyboard.press("Shift+I");
  await expect(pills).toHaveCount(0);
  await expect(page.getByText("The inference engine has not been started")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await page.keyboard.press("r");
  await expect(bar).toHaveAttribute("aria-label", "Rectangle options");
  await expect(pills).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(bar).toHaveAttribute("aria-label", "Smart select options");
  await expect(pills).toHaveCount(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Help and what's new" }).click();
  const help = page.getByRole("dialog", { name: "Help" });
  const hints = help.getByTestId("help-tool-hints");
  await expect(hints).toBeVisible();
  await expect(hints.getByTestId("help-tool-hint")).not.toHaveCount(0);
  await hints.getByRole("button", { name: "Show the Rectangle hint again" }).click();
  await hints.getByRole("button", { name: "Show the Smart select hint again" }).click();
  await expect(hints.getByRole("button", { name: "Show the Rectangle hint again" })).toHaveCount(0);
  await help.getByRole("button", { name: "Close", exact: true }).last().click();

  await openSlide(page);
  await page.keyboard.press("r");
  await expect(pills).toHaveCount(2);
  await page.keyboard.press("s");
  await expect(pills).toHaveCount(3);
});
