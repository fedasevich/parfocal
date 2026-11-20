import { expect, type Page, test } from "./a11y.ts";
import { openCompare, openCompareOptions } from "./compare-open.ts";

async function boxes(page: Page) {
  const found: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const pane of await page.locator("[data-pane]").all()) {
    const box = await pane.boundingBox();
    const name = await pane.getAttribute("data-pane");
    if (box && name) found[name] = box;
  }
  return found;
}

const layout = (page: Page, name: string) =>
  page.getByRole("radiogroup", { name: "Layout" }).getByRole("radio", { name, exact: true });

test("each layout places its panes where the layout says", async ({ page }) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await openCompareOptions(page);
  const frame = page.locator("[data-layout]:not([data-slot])");

  await expect(frame).toHaveAttribute("data-layout", "side");
  let panes = await boxes(page);
  expect(Object.keys(panes).sort()).toEqual(["left", "right"]);
  expect(panes.left?.y).toBeCloseTo(panes.right?.y ?? -1, 0);
  expect(panes.right?.x ?? 0).toBeGreaterThan((panes.left?.x ?? 0) + (panes.left?.width ?? 0) - 1);

  await layout(page, "Stacked").click();
  await expect(frame).toHaveAttribute("data-layout", "stacked");
  panes = await boxes(page);
  expect(Object.keys(panes).sort()).toEqual(["left", "right"]);
  expect(panes.left?.x).toBeCloseTo(panes.right?.x ?? -1, 0);
  expect(panes.right?.y ?? 0).toBeGreaterThan((panes.left?.y ?? 0) + (panes.left?.height ?? 0) - 1);

  await layout(page, "4").click();
  await expect(frame).toHaveAttribute("data-layout", "four");
  panes = await boxes(page);
  expect(Object.keys(panes).sort()).toEqual(["bottomLeft", "bottomRight", "left", "right"]);
  expect(panes.left?.y).toBeCloseTo(panes.right?.y ?? -1, 0);
  expect(panes.bottomLeft?.y).toBeCloseTo(panes.bottomRight?.y ?? -1, 0);
  expect(panes.left?.x).toBeCloseTo(panes.bottomLeft?.x ?? -1, 0);
  expect(panes.bottomLeft?.y ?? 0).toBeGreaterThan(panes.left?.y ?? 0);
  expect(panes.bottomRight?.x ?? 0).toBeGreaterThan(panes.bottomLeft?.x ?? 0);

  await layout(page, "1").click();
  await expect(frame).toHaveAttribute("data-layout", "one");
  panes = await boxes(page);
  expect(Object.keys(panes)).toEqual(["left"]);
});

test("four panes move together while linked and each pane picks its own slide", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openCompare(page);
  await openCompareOptions(page);
  await layout(page, "4").click();
  for (const pane of ["right", "bottomLeft", "bottomRight"]) {
    await expect(page.getByTestId(`rotation-${pane}`)).toHaveText("0°");
  }
  await expect(page.locator('[data-slot="crosshair"]')).toHaveCount(4);
  await page.getByRole("button", { name: "Compare options" }).click();
  await page.getByRole("button", { name: "Rotate bottom right pane right" }).click();
  await expect(page.getByTestId("rotation-bottomRight")).toHaveText("15°");
  await expect(page.getByTestId("rotation-bottomLeft")).toHaveText("0°");

  await page.getByRole("button", { name: "Compare options" }).click();
  await page.getByRole("button", { name: "Change the bottom left slide" }).click();
  await expect(page.getByRole("listbox", { name: "Slide for the bottom left side" })).toBeVisible();
});
