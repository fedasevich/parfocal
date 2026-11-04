import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: import("@playwright/test").Page) {
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

test("M drops markers of the active class, counts them and Shift-click deletes one", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("m");
  await expect(stage).toHaveAttribute("data-tool", "marker");
  const rows = page.getByTestId("count-row");
  await expect(rows.nth(1)).toBeVisible();

  await page.mouse.click(box.x + 300, box.y + 300);
  await page.mouse.click(box.x + 360, box.y + 300);
  await page.keyboard.press("2");
  await page.mouse.click(box.x + 420, box.y + 300);

  const markers = page.getByTestId("count-marker");
  await expect(markers).toHaveCount(3);
  await expect(page.getByTestId("count-panel")).toHaveAttribute("data-total", "3");
  await expect(rows.nth(0)).toHaveAttribute("data-count", "2");
  await expect(rows.nth(1)).toHaveAttribute("data-count", "1");
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 360, box.y + 300);
  await page.keyboard.up("Shift");
  await expect(markers).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-count", "1");
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await expect(page.getByTestId("count-panel")).toHaveAttribute("data-total", "2");
});
