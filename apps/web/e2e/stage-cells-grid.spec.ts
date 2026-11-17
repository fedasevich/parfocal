import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
}

test("the cells address opens the engine stage with a grid of stored crops", async ({ page }) => {
  const crops: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes(`/api/slides/${cellsSlide}/cell-crops/`)) {
      crops.push(response.status());
    }
  });
  await page.goto(`/tasks/${rt14}/cells?slide=${cellsSlide}`);
  await ready(page);
  const grid = page.getByTestId("stage-cells-grid");
  const tiles = grid.locator("[data-crop]");
  await expect(tiles).toHaveCount(3);
  const image = tiles.first().locator('[data-slot="gallery-tile-image"]');
  await expect(image).toHaveCSS("background-image", /\/cell-crops\/\d+/);
  await expect.poll(() => crops.length).toBeGreaterThan(0);
  expect(crops.every((status) => status === 200)).toBe(true);
  await grid.getByRole("button", { name: /^C2 / }).click();
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-current", "C2");
  await expect(page.getByTestId("cell-type-bar")).toHaveAttribute("aria-label", "Type for C2");
});

test("the engine viewer opens the cells grid and agrees with the rest", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}`);
  await ready(page);
  const card = page.getByTestId("stage-review-objects");
  await expect(page.getByTestId("stage-cells-grid")).toHaveCount(0);
  await card.getByRole("button", { name: "Show the cells grid" }).click();
  const grid = page.getByTestId("stage-cells-grid");
  await expect(grid.locator("[data-crop]")).toHaveCount(3);
  await grid.getByRole("button", { name: /Agree with the rest/ }).click();
  await grid.getByRole("button", { name: /Agree with 3/ }).click();
  const rows = card.locator('[data-testid="stage-review-object"]');
  await expect(rows.and(page.locator('[data-decision="agree"]'))).toHaveCount(3);
  await card.getByRole("button", { name: "Hide the cells grid" }).click();
  await expect(grid).toHaveCount(0);
});
