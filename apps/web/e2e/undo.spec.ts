import { expect, type Page, test } from "@playwright/test";

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

const corners = [
  [200, 150],
  [420, 170],
  [380, 360],
  [220, 330],
] as const;

async function drawSquare(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
}

test("undo takes back a drawn polygon on the server too", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawSquare(page, box);
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.press("Control+z");
  await expect(shape).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shape).toHaveCount(0);
});

test("redo puts an undone polygon back on the server too", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawSquare(page, box);
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(shape).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(shape).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shape).toHaveCount(1);
});

test("undo removes the last draft vertex before any committed edit", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 300, box.y + 150);
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(0);
});
