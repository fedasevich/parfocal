import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

const tools: { tool: string; keys: string; stage: string }[] = [
  { tool: "select", keys: "v", stage: "select" },
  { tool: "smart", keys: "s", stage: "smart" },
  { tool: "auto", keys: "u", stage: "auto" },
  { tool: "poly", keys: "p", stage: "polygon" },
  { tool: "free", keys: "Shift+P", stage: "freehand" },
  { tool: "rect", keys: "r", stage: "rectangle" },
  { tool: "ellipse", keys: "o", stage: "ellipse" },
  { tool: "marker", keys: "m", stage: "marker" },
  { tool: "ruler", keys: "l", stage: "ruler" },
  { tool: "arrow", keys: "Shift+L", stage: "arrow" },
  { tool: "text", keys: "t", stage: "text" },
  { tool: "comment", keys: "c", stage: "comment" },
  { tool: "brush", keys: "b", stage: "brush" },
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
  return stage;
}

test("the rail shows the five families and every tool answers its key and its button", async ({
  page,
}) => {
  const stage = await openSlide(page);
  await expect(page.locator("button[data-tool]")).toHaveCount(14);

  for (const item of tools) {
    const button = page.locator(`button[data-tool="${item.tool}"]`);
    await expect(button).toBeVisible();
    await page.keyboard.press(item.keys);
    await expect(stage).toHaveAttribute("data-tool", item.stage);
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(stage).toHaveAttribute("data-tool", "hand");

    await button.click();
    await expect(stage).toHaveAttribute("data-tool", item.stage);
    await button.click();
    await expect(stage).toHaveAttribute("data-tool", "hand");
  }

  await page.keyboard.press("v");
  await page.keyboard.press("h");
  await expect(stage).toHaveAttribute("data-tool", "hand");
  await expect(page.locator('button[data-tool="hand"]')).toHaveAttribute("aria-pressed", "true");
});
