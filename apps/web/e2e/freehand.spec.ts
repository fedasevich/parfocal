import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

test("Shift P draws a freehand stroke that is simplified and saved, and Escape leaves the tool", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("Shift+P");
  await expect(stage).toHaveAttribute("data-tool", "freehand");
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  const steps = 80;
  for (let i = 1; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    await page.mouse.move(box.x + 300 + 100 * Math.sin(angle), box.y + 300 - 100 * Math.cos(angle));
  }
  await page.mouse.up();
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const points = Number(await shape.getAttribute("data-points"));
  expect(points).toBeGreaterThanOrEqual(8);
  expect(points).toBeLessThan(steps);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "hand");
});
