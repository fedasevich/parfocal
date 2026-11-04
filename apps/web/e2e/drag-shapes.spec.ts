import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

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

test("R drags a rectangle and Shift makes it a square", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 260, { steps: 5 });
  await page.mouse.up();
  const shapes = page.getByTestId("polygon-shape");
  await expect(shapes).toHaveCount(1);
  expect(Number(await shapes.nth(0).getAttribute("data-points"))).toBe(4);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.mouse.move(box.x + 500, box.y + 200);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 700, box.y + 260, { steps: 5 });
  const preview = page.getByTestId("drag-preview").first();
  await expect(page.getByTestId("drag-layer").first()).toHaveAttribute("data-equal-sides", "true");
  const size = await preview.boundingBox();
  expect(Math.abs((size?.width ?? 0) - (size?.height ?? 1))).toBeLessThan(3);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(shapes).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "hand");
});

test("O drags an ellipse and Shift makes it a circle", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("o");
  await expect(stage).toHaveAttribute("data-tool", "ellipse");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 420, box.y + 280, { steps: 5 });
  await expect(page.getByTestId("drag-layer").nth(1)).toHaveAttribute("data-equal-sides", "true");
  const size = await page.getByTestId("drag-preview").boundingBox();
  expect(Math.abs((size?.width ?? 0) - (size?.height ?? 1))).toBeLessThan(3);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const shapes = page.getByTestId("polygon-shape");
  await expect(shapes).toHaveCount(1);
  expect(Number(await shapes.nth(0).getAttribute("data-points"))).toBe(64);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});
