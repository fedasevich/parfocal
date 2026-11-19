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
  await card.getByRole("button", { name: "Show the cells" }).click();
  const grid = page.getByTestId("stage-cells-grid");
  await expect(grid.locator("[data-crop]")).toHaveCount(3);
  await grid.getByRole("button", { name: /Agree with the rest/ }).click();
  await grid.getByRole("button", { name: /Agree with 3/ }).click();
  await expect(card.getByTestId("object-row-cells")).toContainText("3 of 3 decided");
  await grid.getByRole("button", { name: "Close the cells" }).click();
  await expect(grid).toHaveCount(0);
});

const cameraOf = (page: Page) => page.getByTestId("slide-host").getAttribute("data-camera");

async function settledCamera(page: Page) {
  let last = await cameraOf(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(250);
      const now = await cameraOf(page);
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return (last ?? "").split(",").map(Number);
}

const barOffCentre = (page: Page) =>
  page.getByTestId("cell-type-bar").evaluate((bar) => {
    const frame = (bar as HTMLElement).offsetParent ?? document.body;
    const box = bar.getBoundingClientRect();
    const around = frame.getBoundingClientRect();
    return Math.abs(box.left + box.width / 2 - (around.left + around.width / 2));
  });

async function picked(page: Page, cell: string) {
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-current", cell);
  const tile = page.getByTestId("stage-cells-grid").getByRole("button", {
    name: new RegExp(`^${cell} `),
  });
  await expect(tile).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("cell-type-bar")).toHaveAttribute("aria-label", `Type for ${cell}`);
  return settledCamera(page);
}

async function openCells(page: Page) {
  await page.goto(`/tasks/${rt14}/cells?slide=${cellsSlide}`);
  await ready(page);
  await expect(page.getByTestId("stage-cells-grid").locator("[data-crop]")).toHaveCount(3);
  return settledCamera(page);
}

const tileOrder = (page: Page) =>
  page
    .getByTestId("stage-cells-grid")
    .locator("[data-crop]")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")?.split(" ")[0]));

test("the arrow keys step one cell each and the camera stays put while the cell is in view", async ({
  page,
}) => {
  const opened = await openCells(page);
  await page.keyboard.press("ArrowRight");
  expect(await picked(page, "C1")).toEqual(opened);
  await page.keyboard.press("ArrowRight");
  expect(await picked(page, "C2")).toEqual(opened);
  await page.keyboard.press("ArrowDown");
  const [x = 0, , zoom = 0] = await picked(page, "C3");
  expect(Math.abs(x - 420)).toBeLessThan(1);
  expect(zoom).toBe(opened[2]);
  await expect.poll(() => barOffCentre(page)).toBeLessThan(3);
  const strip = await page.getByTestId("stage-cells-grid").boundingBox();
  const bar = await page.getByTestId("cell-type-bar").boundingBox();
  expect((bar?.y ?? 0) + (bar?.height ?? 0)).toBeLessThan(strip?.y ?? 0);
  await page.keyboard.press("ArrowRight");
  await picked(page, "C3");
  await page.keyboard.press("ArrowUp");
  const second = await picked(page, "C2");
  expect(Math.abs((second[0] ?? 0) - 520)).toBeLessThan(1);
  expect(second[2]).toBe(opened[2]);
  await page.keyboard.press("ArrowLeft");
  expect(await picked(page, "C1")).toEqual(second);
});

async function landFromFarOut(page: Page) {
  const opened = await openCells(page);
  for (let press = 0; press < 3; press += 1) await page.keyboard.press("-");
  const out = await settledCamera(page);
  expect(out[2] ?? 0).toBeLessThan((opened[2] ?? 0) - 0.5);
  await page.keyboard.press("ArrowRight");
  const landed = await picked(page, "C1");
  expect(Math.abs((landed[0] ?? 0) - 300)).toBeLessThan(1);
  return landed;
}

test("a cell too small to judge on a 20x slide is flown to at 20x", async ({ page }) => {
  const landed = await landFromFarOut(page);
  await expect(page.getByTestId("magnification-bar")).toHaveAttribute(
    "aria-label",
    /^Magnification 20×/,
  );
  await page.keyboard.press("ArrowRight");
  expect((await picked(page, "C2"))[2]).toBe(landed[2]);
});

test("a cell too small to judge on a 40x slide is flown to at 40x and later steps keep it", async ({
  page,
}) => {
  await page.context().route("**/levels.json", async (route) => {
    const response = await route.fetch();
    const table = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...table, scale: { mpp_x: 0.25, mpp_y: 0.25 } } });
  });
  const landed = await landFromFarOut(page);
  const bar = page.getByTestId("magnification-bar");
  await expect(bar).toHaveAttribute("aria-label", /^Magnification 40×/);
  await page.keyboard.press("ArrowRight");
  expect((await picked(page, "C2"))[2]).toBe(landed[2]);
  await page.keyboard.press("ArrowDown");
  expect((await picked(page, "C3"))[2]).toBe(landed[2]);
  await expect(bar).toHaveAttribute("aria-label", /^Magnification 40×/);
});

test("the strip follows the tissue and keeps its order after a reload", async ({ page }) => {
  await openCells(page);
  const order = await tileOrder(page);
  expect(order).toEqual(["C1", "C2", "C3"]);
  await page.reload();
  await ready(page);
  await expect(page.getByTestId("stage-cells-grid").locator("[data-crop]")).toHaveCount(3);
  expect(await tileOrder(page)).toEqual(order);
});

test("a key decision in the strip moves to the next undecided cell", async ({ page }) => {
  const opened = await openCells(page);
  const card = page.getByTestId("stage-review-objects");
  const grid = page.getByTestId("stage-cells-grid");
  await page.keyboard.press("ArrowRight");
  await picked(page, "C1");
  await page.keyboard.press("k");
  expect(await picked(page, "C2")).toEqual(opened);
  await expect(grid.getByRole("button", { name: /^C1 / })).toHaveAttribute("data-state", "done");
  await page.keyboard.press("ArrowRight");
  await picked(page, "C3");
  await page.keyboard.press("x");
  await picked(page, "C2");
  await page.keyboard.press("u");
  await expect(card).toHaveAttribute("data-current", "C2");
  await expect(grid.locator('[data-crop][data-state="to-check"]')).toHaveCount(0);
});

test("the arrows pan with Shift, and again on their own once the strip is closed", async ({
  page,
}) => {
  await openCells(page);
  const card = page.getByTestId("stage-review-objects");
  const grid = page.getByTestId("stage-cells-grid");
  await page.keyboard.press("ArrowRight");
  const start = (await picked(page, "C1")).join(",");
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => cameraOf(page)).not.toBe(start);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(card).toHaveAttribute("data-current", "C1");
  await page.keyboard.press("Shift+K");
  await expect(grid.getByRole("button", { name: /Agree with 3/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("button", { name: /Agree with the rest/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid).toHaveCount(0);
  const before = (await settledCamera(page)).join(",");
  await page.keyboard.down("ArrowRight");
  await expect.poll(async () => (await settledCamera(page)).join(",")).not.toBe(before);
  await page.keyboard.up("ArrowRight");
  await expect(card).toHaveAttribute("data-current", "C1");
});
