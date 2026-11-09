import { expect, type Page, test } from "./a11y.ts";

async function openCompare(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await page.getByRole("button", { name: /^A1/ }).first().click();
  const slides = page.getByRole("dialog", { name: "Slides in this case and task" });
  await slides
    .getByRole("button", { name: /Side by side with/ })
    .first()
    .click();
  await expect(page).toHaveURL(/scene=picked/);
}

async function crosshairIn(page: Page, side: "left" | "right") {
  const pane = page.locator(`[data-pane="${side}"]`);
  const paneBox = await pane.boundingBox();
  const mark = await pane.locator('[data-slot="crosshair"]').boundingBox();
  if (paneBox === null || mark === null) throw new Error("missing pane or crosshair");
  return {
    x: Math.round(mark.x - paneBox.x + mark.width / 2),
    y: Math.round(mark.y - paneBox.y + mark.height / 2),
  };
}

test("the shared cursor sits on the same point of both panes, follows rotation and the link", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  const left = await page.locator('[data-pane="left"]').boundingBox();
  if (left === null) throw new Error("no left pane");

  await page.mouse.move(left.x + left.width * 0.3, left.y + left.height * 0.6);
  await expect
    .poll(() => crosshairIn(page, "left"))
    .toEqual({
      x: Math.round(left.width * 0.3),
      y: Math.round(left.height * 0.6),
    });
  const there = await crosshairIn(page, "right");
  expect(Math.abs(there.x - Math.round(left.width * 0.7))).toBeLessThanOrEqual(1);
  expect(Math.abs(there.y - Math.round(left.height * 0.6))).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Rotate left pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
  const turnedLeft = await crosshairIn(page, "left");
  const turnedRight = await crosshairIn(page, "right");
  expect(Math.abs(turnedLeft.x + turnedRight.x - Math.round(left.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(turnedLeft.y - turnedRight.y)).toBeLessThanOrEqual(1);

  await page.getByRole("switch", { name: "Linked" }).click();
  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("30°");
  const apartRight = await crosshairIn(page, "right");
  const apartLeft = await crosshairIn(page, "left");
  expect(
    Math.abs(apartRight.x + apartLeft.x - Math.round(left.width)) +
      Math.abs(apartRight.y - apartLeft.y),
  ).toBeGreaterThan(2);

  await page.getByRole("switch", { name: "Shared cursor" }).click();
  await expect(page.locator('[data-slot="crosshair"]')).toHaveCount(0);
});
