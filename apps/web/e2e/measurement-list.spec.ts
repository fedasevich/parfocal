import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Objects" }).click();
  return page.getByTestId("slide-stage");
}

test("each ruler line joins the measurement list with its value and a time, and can be removed", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const list = page.getByTestId("measurement-list");
  await expect(list).toContainText("Nothing measured yet");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.keyboard.press("l");
  const y = box.y + box.height / 2;
  for (const offset of [0, 40]) {
    await page.mouse.move(box.x + 200, y + offset);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, y + offset, { steps: 4 });
    await page.mouse.up();
  }
  const rows = list.getByTestId("measurement-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("M1");
  await expect(rows.nth(1)).toContainText("M2");
  await expect(rows.first().locator("[data-slot=value]")).toHaveText(/^\d+(\.\d+)? (µm|mm)$/);
  await expect(list.getByTestId("measurement-group")).toHaveAttribute("data-group", "Rulers");
  await expect(list.getByRole("heading", { name: "Rulers 2" })).toBeVisible();
  await expect(rows.first().locator("[data-slot=time]")).toHaveText(/^\d\d:\d\d$/);
  await page.getByRole("button", { name: "Remove M1" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("M1");
});

test("an area row keeps its size on one line with the perimeter under it, and the area list grows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=annotate&tab=objects`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  const corners = [
    [420, 250],
    [700, 270],
    [680, 520],
    [440, 500],
  ] as const;
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  const row = page.getByTestId("measurement-row").filter({ has: page.locator("[data-slot=area]") });
  await expect(row).toHaveCount(1);
  const area = row.locator("[data-slot=area]");
  const perimeter = row.locator("[data-slot=value]");
  await expect(perimeter).toContainText("perimeter");
  const areaBox = await area.boundingBox();
  const perimeterBox = await perimeter.boundingBox();
  expect(areaBox?.height ?? 0).toBeLessThan(26);
  expect(perimeterBox?.height ?? 0).toBeLessThan(22);
  expect(perimeterBox?.y ?? 0).toBeGreaterThan(areaBox?.y ?? 0);
  const areaList = page.getByTestId("area-nav").getByLabel("Areas, largest first");
  const clipped = await areaList.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
  expect(clipped).toBe(false);
});
