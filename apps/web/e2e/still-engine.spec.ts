import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

const regionShapeCount = 6;

const engine = (page: Page) => page.getByTestId("still-engine");

async function fullViewerHref(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return (await link.getAttribute("href")) ?? "";
}

async function engineReady(page: Page) {
  await expect(engine(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(engine(page).locator("canvas").first()).toBeVisible();
}

test("guided review draws the slide with the Viv canvas and the engine object layer", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=cellwhole`);
  await engineReady(page);
  const drawn = Number(await engine(page).getAttribute("data-objects"));
  expect(drawn).toBeGreaterThan(0);
  expect(Number(await engine(page).getAttribute("data-overlays"))).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="slide-still"] svg image')).toHaveCount(0);
  await expect(page.locator('[data-slot="slide-still"] svg[role="img"] > g > path')).toHaveCount(
    regionShapeCount - drawn,
  );
});

test("guided review keeps the current region as the still's tinted outline", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=region`);
  await engineReady(page);
  const drawn = Number(await engine(page).getAttribute("data-objects"));
  expect(drawn).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="slide-still"] svg[role="img"] > g > path')).toHaveCount(
    regionShapeCount - drawn,
  );
});

test("guided review follows the Display settings through the engine", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=display`);
  await engineReady(page);
  await expect(engine(page)).toHaveAttribute("data-draw", "outline");
  await expect(engine(page)).toHaveAttribute("data-width", "2");
});

test("guided review draws no AI objects through the engine before the claim is shown", async ({
  page,
}) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=blind`);
  await engineReady(page);
  await expect(engine(page)).toHaveAttribute("data-objects", "0");
  await expect(page.locator('[data-slot="slide-still"] svg[role="img"] > g > path')).toHaveCount(
    regionShapeCount,
  );
});

test("the full viewer draws the slide with the Viv canvas and the engine object layer", async ({
  page,
}) => {
  await page.goto(await fullViewerHref(page));
  await engineReady(page);
  expect(Number(await engine(page).getAttribute("data-objects"))).toBeGreaterThan(0);
  expect(Number(await engine(page).getAttribute("data-overlays"))).toBeGreaterThan(0);
  await expect(page.locator('[data-slot="slide-still"] svg image')).toHaveCount(0);
});

test("the cell view stays on the still", async ({ page }) => {
  await page.goto(`/tasks/${rt14}/guided?slide=${a1}&scene=grid`);
  await expect(page.locator('[data-slot="slide-still"] svg image')).toHaveCount(1);
  await expect(engine(page)).toHaveCount(0);
});
