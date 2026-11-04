import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
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
  await expect(rows.first().locator("[data-slot=category-tag]")).toHaveText("Ruler");
  await expect(rows.first().locator("[data-slot=time]")).toHaveText(/^\d\d:\d\d$/);
  await page.getByRole("button", { name: "Remove M1" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("M1");
});
