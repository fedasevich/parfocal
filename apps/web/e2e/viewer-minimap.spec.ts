import { expect, type Page, test } from "@playwright/test";

const minimap = (page: Page) => page.locator('[data-slot="smart-minimap"]');

async function openScene(page: Page, name: string) {
  await page.goto("/prototype");
  const link = page.getByRole("list", { name: "Screens" }).getByRole("link", { name, exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await expect(page.getByTestId("full-viewer")).toBeVisible();
}

test("the full viewer shows the reading map on a region and hides it on the whole slide", async ({
  page,
}) => {
  await openScene(page, "Full viewer, one object · An open region, T5");
  await expect(minimap(page)).toHaveAttribute("data-mode", "reading");
  await expect(minimap(page)).toHaveAttribute("data-size", "full");
  await page.getByRole("button", { name: "Whole slide", exact: true }).click();
  await expect(minimap(page)).toHaveCount(0);
});

test("the map moves to the compact area map when a cell is zoomed to 20x or more", async ({
  page,
}) => {
  await openScene(page, "Full viewer · Cells panel open");
  await expect(minimap(page)).toHaveAttribute("data-mode", "area");
  await expect(minimap(page)).toHaveAttribute("data-size", "compact");
});

test("the map fades once the pointer is within 40 px and clears again beyond", async ({ page }) => {
  await openScene(page, "Full viewer, one object · An open region, T5");
  const map = minimap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the minimap has no box");
  await page.mouse.move(box.x - 30, box.y + box.height / 2);
  await expect(map).toHaveAttribute("data-faded", "true");
  await page.mouse.move(box.x - 120, box.y + box.height / 2);
  await expect(map).not.toHaveAttribute("data-faded", "true");
});

test("clicking the faded map still opens the whole-slide peek", async ({ page }) => {
  await openScene(page, "Full viewer, one object · An open region, T5");
  const map = minimap(page);
  const box = await map.boundingBox();
  if (box === null) throw new Error("the minimap has no box");
  await page.mouse.move(box.x - 20, box.y + 40);
  await expect(map).toHaveAttribute("data-faded", "true");
  await map.getByRole("button", { name: "Open the whole slide" }).click();
  await expect(page).toHaveURL(/peek=true/);
});

test("clicking the map opens the whole-slide peek", async ({ page }) => {
  await openScene(page, "Full viewer, one object · An open region, T5");
  const open = minimap(page).getByRole("button", { name: "Open the whole slide" });
  await expect(open).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/peek=true/);
});

test("the area map shows a dot for each cell of the area", async ({ page }) => {
  await openScene(page, "Full viewer · Cells panel open");
  await expect(minimap(page).locator('[data-slot="map-dots"] circle').first()).toBeVisible();
});

test("dragging the viewport rectangle moves the view and does not open the peek", async ({
  page,
}) => {
  await openScene(page, "Full viewer, one object · An open region, T5");
  const viewport = minimap(page).locator('[data-slot="map-viewport"]');
  await expect(minimap(page)).toBeVisible();
  let settled = await viewport.boundingBox();
  await expect
    .poll(async () => {
      const now = await viewport.boundingBox();
      const same = JSON.stringify(now) === JSON.stringify(settled);
      settled = now;
      return same;
    })
    .toBe(true);
  const before = settled;
  if (before === null) throw new Error("the viewport rectangle has no box");
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y + 14, { steps: 4 });
  await page.mouse.up();
  await expect(page).not.toHaveURL(/peek=true/);
  const after = await viewport.boundingBox();
  expect(after?.x).not.toBe(before.x);
});
