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

test("P draws a polygon that is saved and still there after a reload", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawSquare(page, box);
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-points", "4");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const drawn = await shape.getAttribute("data-vertices");

  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-points", "4");
  expect(await shape.getAttribute("data-vertices")).toBe(drawn);
});

test("Escape drops an unfinished polygon and a second Escape leaves the tool", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.getByRole("button", { name: "Polygon" }).click();
  await expect(stage).toHaveAttribute("data-tool", "polygon");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 300, box.y + 150);
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

test("a double-click closes the polygon on its last vertex", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.mouse.dblclick(box.x + 300, box.y + 320);
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "3");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});
