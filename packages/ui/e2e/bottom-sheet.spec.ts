import { expect, type Page, test } from "@playwright/test";

test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

const url = "/iframe.html?id=components-bottom-sheet--default&viewMode=story";
const sheet = '[data-slot="bottom-sheet"]';

type Point = { x: number; y: number };

const swipe = async (page: Page, from: Point, to: Point, steps = 6) => {
  const client = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", point?: Point) =>
    client.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point ? [{ x: point.x, y: point.y }] : [],
    });
  await touch("touchStart", from);
  for (let step = 1; step <= steps; step += 1) {
    await touch("touchMove", {
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await page.waitForTimeout(40);
  }
  await touch("touchEnd");
};

const handleCentre = async (page: Page): Promise<Point> => {
  const box = await page.locator('[data-slot="bottom-sheet-handle"]').boundingBox();
  if (!box) throw new Error("the sheet handle is not visible");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const settled = (page: Page, height: string) =>
  expect(page.locator(sheet)).toHaveAttribute("data-height", height);

test("a slow drag up moves the sheet from peek to half and on to full", async ({ page }) => {
  await page.goto(url);
  await settled(page, "peek");
  const first = await handleCentre(page);
  await swipe(page, first, { x: first.x, y: first.y - 200 }, 40);
  await settled(page, "half");
  const second = await handleCentre(page);
  await swipe(page, second, { x: second.x, y: second.y - 280 }, 40);
  await settled(page, "full");
});

test("a slow drag down moves the sheet back to peek", async ({ page }) => {
  await page.goto(url);
  const first = await handleCentre(page);
  await swipe(page, first, { x: first.x, y: first.y - 500 }, 40);
  await settled(page, "full");
  const second = await handleCentre(page);
  await swipe(page, second, { x: second.x, y: second.y + 600 }, 40);
  await settled(page, "peek");
});

test("a quick fling up moves the sheet one height", async ({ page }) => {
  await page.goto(url);
  const start = await handleCentre(page);
  await swipe(page, start, { x: start.x, y: start.y - 120 }, 3);
  await settled(page, "half");
});

test("a swipe left on the sheet body asks for the next cell", async ({ page }) => {
  await page.goto(url);
  const body = await page.locator('[data-slot="bottom-sheet-body"]').boundingBox();
  if (!body) throw new Error("the sheet body is not visible");
  const from = { x: body.x + 600, y: body.y + 20 };
  await expect(page.getByTestId("cell")).toHaveText("Cell 1");
  await swipe(page, from, { x: from.x - 240, y: from.y + 4 }, 4);
  await expect(page.getByTestId("cell")).toHaveText("Cell 2");
});

test("a swipe right does not change the cell", async ({ page }) => {
  await page.goto(url);
  const body = await page.locator('[data-slot="bottom-sheet-body"]').boundingBox();
  if (!body) throw new Error("the sheet body is not visible");
  const from = { x: body.x + 300, y: body.y + 20 };
  await swipe(page, from, { x: from.x + 240, y: from.y }, 4);
  await expect(page.getByTestId("cell")).toHaveText("Cell 1");
});
