import { expect, type Page, test } from "./a11y.ts";
import { openCompare, openCompareOptions, stillEngineOn } from "./compare-open.ts";

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

test("the shared cursor sits on the same point of the live stage and the right pane", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await expect(stillEngineOn(page, "right")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const left = await page.locator('[data-pane="left"]').boundingBox();
  if (left === null) throw new Error("no left pane");

  await page.mouse.move(left.x + left.width * 0.3, left.y + left.height * 0.6);
  await expect
    .poll(() => crosshairIn(page, "left"))
    .toEqual({
      x: Math.round(left.width * 0.3),
      y: Math.round(left.height * 0.6),
    });
  await expect
    .poll(async () => {
      const there = await crosshairIn(page, "right");
      return (
        Math.abs(there.x - Math.round(left.width * 0.3)) +
        Math.abs(there.y - Math.round(left.height * 0.6))
      );
    })
    .toBeLessThanOrEqual(3);

  await page.getByRole("button", { name: "Rotate right pane right" }).click();
  await expect(page.getByTestId("rotation-right")).toHaveText("15°");
  await expect(page.locator('[data-pane="right"] [data-slot="crosshair"]')).toHaveCount(1);

  const options = await openCompareOptions(page);
  await options.getByRole("switch", { name: "Shared cursor" }).click();
  await expect(page.locator('[data-slot="crosshair"]')).toHaveCount(0);
});
