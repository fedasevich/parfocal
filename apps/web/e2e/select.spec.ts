import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  return page.getByTestId("slide-stage");
}

async function drawRuler(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("l");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

const lineOf = (page: Page) => page.getByTestId("ruler-layer").locator("line").first();

test("V arms the select tool, a click picks the ruler and an empty click drops it", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.mouse.click(box.x + 300, box.y + 200);
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "1");
  await expect(page.getByTestId("select-handle")).toHaveCount(2);
  await page.mouse.click(box.x + 300, box.y + 400);
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "");
});

test("a marquee selects the ruler it touches", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 260, { steps: 6 });
  await expect(page.getByTestId("select-marquee")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "1");
});

test("dragging a selected ruler moves it and Shift locks the move to one axis", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  const xBefore = Number(await lineOf(page).getAttribute("x1"));
  const yBefore = Number(await lineOf(page).getAttribute("y1"));
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 235, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const xAfter = Number(await lineOf(page).getAttribute("x1"));
  const yAfter = Number(await lineOf(page).getAttribute("y1"));
  expect(Math.abs(yAfter - yBefore)).toBeLessThan(1);
  expect(xAfter - xBefore).toBeGreaterThan(55);
  expect(xAfter - xBefore).toBeLessThan(65);
});

test("dragging an end handle of the selected ruler reshapes it", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 200);
  const endBefore = Number(await lineOf(page).getAttribute("x2"));
  await page.mouse.move(box.x + 400, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 260, { steps: 6 });
  await page.mouse.up();
  const endAfter = Number(await lineOf(page).getAttribute("x2"));
  expect(endAfter - endBefore).toBeGreaterThan(40);
});

test("Escape in the middle of a move puts the ruler back", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  const before = Number(await lineOf(page).getAttribute("x1"));
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 260, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(Number(await lineOf(page).getAttribute("x1"))).toBeCloseTo(before, 1);
  await expect(stage).toHaveAttribute("data-tool", "select");
});
