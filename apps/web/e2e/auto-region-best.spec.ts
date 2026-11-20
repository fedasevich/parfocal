import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

test("the auto region tool runs once in best quality on one fixture tile", async ({ page }) => {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("u");
  await expect(stage).toHaveAttribute("data-tool", "auto");
  const layer = page.getByTestId("auto-layer");
  await expect(layer).toHaveAttribute("data-quality", "fast");
  const best = page
    .getByRole("group", { name: "Model for outlining nuclei" })
    .getByRole("button", { name: "Best" });
  await best.click();
  await expect(best).toHaveAttribute("aria-pressed", "true");
  await expect(layer).toHaveAttribute("data-quality", "best");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("proposal-layer")).toBeVisible();
  await expect(layer).toHaveAttribute("data-running", "false");
  expect(
    Number(await page.getByTestId("context-bar").getAttribute("data-proposals")),
  ).toBeGreaterThan(0);
});
