import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt16 = "00000000-0000-4000-8043-000000000016";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

test("a fresh task's cells grid has every tile answered by the crop route", async ({ page }) => {
  const answered = new Map<string, number>();
  page.on("response", (response) => {
    const match = response.url().match(/\/api\/slides\/([^/]+)\/cell-crops\/(\d+)/);
    if (match?.[1] === cellsSlide) {
      answered.set(match[2] as string, response.status());
    }
  });
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt16}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page
    .getByTestId("stage-review-objects")
    .getByRole("button", { name: "Show the cells" })
    .click();
  const grid = page.getByTestId("stage-cells-grid");
  const tiles = grid.locator("[data-crop]");
  await expect(tiles.first()).toBeVisible();
  const count = await tiles.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const tile = tiles.nth(index);
    const number = await tile.getAttribute("data-crop");
    await expect(tile.locator('[data-slot="gallery-tile-image"]')).toHaveCSS(
      "background-image",
      new RegExp(`/api/slides/${cellsSlide}/cell-crops/${number}"?\\)$`),
    );
  }
  await expect.poll(() => answered.size).toBe(count);
  expect([...answered.values()].every((status) => status === 200)).toBe(true);
});
