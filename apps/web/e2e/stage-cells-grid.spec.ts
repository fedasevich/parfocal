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
      const now = await cameraOf(page);
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  return last;
}

const barOffCentre = (page: Page) =>
  page.getByTestId("cell-type-bar").evaluate((bar) => {
    const frame = (bar as HTMLElement).offsetParent ?? document.body;
    const box = bar.getBoundingClientRect();
    const around = frame.getBoundingClientRect();
    return Math.abs(box.left + box.width / 2 - (around.left + around.width / 2));
  });

async function pickedAndCentred(page: Page, cell: string) {
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute("data-current", cell);
  const tile = page.getByTestId("stage-cells-grid").getByRole("button", {
    name: new RegExp(`^${cell} `),
  });
  await expect(tile).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("cell-type-bar")).toHaveAttribute("aria-label", `Type for ${cell}`);
  await expect.poll(() => barOffCentre(page)).toBeLessThan(3);
  return settledCamera(page);
}

test("the arrow keys step between cells in the strip and the camera centres on each", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/cells?slide=${cellsSlide}`);
  await ready(page);
  await expect(page.getByTestId("stage-cells-grid").locator("[data-crop]")).toHaveCount(3);
  await page.keyboard.press("ArrowRight");
  const first = await pickedAndCentred(page, "C1");
  await page.keyboard.press("ArrowRight");
  const second = await pickedAndCentred(page, "C2");
  expect(second).not.toBe(first);
  await page.keyboard.press("ArrowDown");
  const third = await pickedAndCentred(page, "C3");
  expect(third).not.toBe(second);
  await page.keyboard.press("ArrowRight");
  await pickedAndCentred(page, "C3");
  await page.keyboard.press("ArrowUp");
  expect(await pickedAndCentred(page, "C2")).toBe(second);
  await page.keyboard.press("ArrowLeft");
  expect(await pickedAndCentred(page, "C1")).toBe(first);
});

test("a key decision in the strip moves to the next undecided cell", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/cells?slide=${cellsSlide}`);
  await ready(page);
  const card = page.getByTestId("stage-review-objects");
  const grid = page.getByTestId("stage-cells-grid");
  await page.keyboard.press("ArrowRight");
  await pickedAndCentred(page, "C1");
  await page.keyboard.press("k");
  await pickedAndCentred(page, "C2");
  await expect(grid.getByRole("button", { name: /^C1 / })).toHaveAttribute("data-state", "done");
  await page.keyboard.press("ArrowRight");
  await pickedAndCentred(page, "C3");
  await page.keyboard.press("x");
  await pickedAndCentred(page, "C2");
  await page.keyboard.press("u");
  await expect(card).toHaveAttribute("data-current", "C2");
  await expect(grid.locator('[data-crop][data-state="to-check"]')).toHaveCount(0);
});

test("the arrows pan with Shift, and again on their own once the strip is closed", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/cells?slide=${cellsSlide}`);
  await ready(page);
  const card = page.getByTestId("stage-review-objects");
  const grid = page.getByTestId("stage-cells-grid");
  await page.keyboard.press("ArrowRight");
  const centred = await pickedAndCentred(page, "C1");
  await page.keyboard.down("Shift");
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => cameraOf(page)).not.toBe(centred);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("Shift");
  await expect(card).toHaveAttribute("data-current", "C1");
  await page.keyboard.press("Shift+K");
  await expect(grid.getByRole("button", { name: /Agree with 3/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid.getByRole("button", { name: /Agree with the rest/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(grid).toHaveCount(0);
  const before = await settledCamera(page);
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => cameraOf(page)).not.toBe(before);
  await page.keyboard.up("ArrowRight");
  await expect(card).toHaveAttribute("data-current", "C1");
});
