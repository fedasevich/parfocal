import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  return page.getByTestId("slide-stage");
}

const labels = (page: Page) => page.getByTestId("ruler-layer").locator("text");

test("the L key arms the ruler and a drag leaves a line with its length in the mono label", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.keyboard.press("l");
  await expect(stage).toHaveAttribute("data-tool", "ruler");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, y + 3, { steps: 6 });
  await expect(labels(page)).toHaveCount(1);
  await page.mouse.up();
  await expect(labels(page)).toHaveCount(1);
  await expect(labels(page).first()).toHaveText(/^\d+(\.\d+)? (µm|mm)$/);
});

test("Shift snaps the dragged line to a multiple of 45 degrees", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.keyboard.press("l");
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 215, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const line = page.getByTestId("ruler-layer").locator("line").first();
  const y1 = Number(await line.getAttribute("y1"));
  const y2 = Number(await line.getAttribute("y2"));
  expect(Math.abs(y2 - y1)).toBeLessThan(0.01);
});

test("Escape switches the ruler off", async ({ page }) => {
  const stage = await openSlide(page);
  await page.keyboard.press("l");
  await expect(stage).toHaveAttribute("data-tool", "ruler");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});
