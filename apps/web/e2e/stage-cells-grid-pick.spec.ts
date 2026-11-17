import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const cellsSlide = "00000000-0000-4000-8005-000000000008";

test.use({ viewport: { width: 1440, height: 900 } });

async function cameraOf(page: Page) {
  const raw = (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "";
  return raw.split(",").map(Number);
}

test("a tile from the crop route centres the stage on its cell and selects it", async ({
  page,
}) => {
  const answered = new Map<string, number>();
  page.on("response", (response) => {
    const match = response.url().match(/\/api\/slides\/([^/]+)\/cell-crops\/(\d+)/);
    if (match?.[1] === cellsSlide) answered.set(match[2] as string, response.status());
  });
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}`);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  const card = page.getByTestId("stage-review-objects");
  await card.getByRole("button", { name: "Show the cells grid" }).click();
  const grid = page.getByTestId("stage-cells-grid");
  const tiles = grid.locator("[data-crop]");
  await expect(tiles).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const number = await tiles.nth(index).getAttribute("data-crop");
    await expect(tiles.nth(index).locator('[data-slot="gallery-tile-image"]')).toHaveCSS(
      "background-image",
      new RegExp(`/api/slides/${cellsSlide}/cell-crops/${number}"?\\)$`),
    );
  }
  await expect.poll(() => answered.size).toBe(3);
  expect([...answered.values()].every((status) => status === 200)).toBe(true);

  const centres: string[] = [];
  for (const name of ["C1", "C2", "C3"]) {
    await grid.getByRole("button", { name: new RegExp(`^${name} `) }).click();
    await expect(card).toHaveAttribute("data-current", name);
    await expect(page.getByTestId("cell-type-bar")).toHaveAttribute(
      "aria-label",
      `Type for ${name}`,
    );
    await expect
      .poll(async () => {
        const first = (await cameraOf(page)).join(",");
        await page.waitForTimeout(400);
        return first === (await cameraOf(page)).join(",");
      })
      .toBe(true);
    const [x = 0, y = 0, zoom = 0] = await cameraOf(page);
    expect(zoom).toBeGreaterThan(0);
    centres.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  expect(new Set(centres).size).toBe(3);
});
