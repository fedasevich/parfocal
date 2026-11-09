import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.setViewportSize({ width: 480, height: 640 });
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  return page.getByTestId("area-nav");
}

const magnification = async (page: Page) => {
  const label = (await page.getByTestId("magnification-bar").getAttribute("aria-label")) ?? "";
  return Number(/(\d+(?:\.\d+)?)/.exec(label)?.[1] ?? Number.NaN);
};

test("] and [ step the areas, a close area counts as visited past 10x and Alt+Left goes back", async ({
  page,
}) => {
  const nav = await openSlide(page);
  await expect(nav).toHaveAttribute("data-current", "");
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T1");
  await expect.poll(() => magnification(page)).toBeLessThan(10);
  await expect(nav).toHaveAttribute("data-visited", "");
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T2");
  await expect(nav).toHaveAttribute("data-visited", "T2");
  expect(await magnification(page)).toBeGreaterThan(10);
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T3");
  await expect(nav).toHaveAttribute("data-visited", "T2 T3");
  await page.keyboard.press("[");
  await expect(nav).toHaveAttribute("data-current", "T2");
  await page.keyboard.press("[");
  await expect(nav).toHaveAttribute("data-current", "T1");
  await expect(nav).toHaveAttribute("data-visited", "T2 T3");
  await page.waitForTimeout(1500);
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T2");
  await expect.poll(() => magnification(page)).toBeGreaterThan(10);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect.poll(() => magnification(page), { timeout: 15_000 }).toBeLessThan(10);
});

test("G then 2 flies to the second largest area", async ({ page }) => {
  const nav = await openSlide(page);
  await page.keyboard.press("g");
  await page.keyboard.press("2");
  await expect(nav).toHaveAttribute("data-current", "T2");
});

test("the area list picks an area, ] steps on from it and the rows mark visits", async ({
  page,
}) => {
  const nav = await openSlide(page);
  const rows = nav.locator("[data-area]");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute("data-area", "T1");
  await nav.getByRole("button", { name: /^T2,/ }).click();
  await expect(nav).toHaveAttribute("data-current", "T2");
  await expect(nav).toHaveAttribute("data-visited", "T2");
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T3");
  await expect(nav.getByRole("button", { name: /^T3,.*visited/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("] starts a flight with a route line, a key press cancels it where it is and a second ] skips to the area", async ({
  page,
}) => {
  const nav = await openSlide(page);
  const travel = page.getByTestId("travel-minimap");
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T1");
  await page.keyboard.press("]");
  await expect(travel).toBeVisible();
  await expect(travel).toHaveAttribute("data-target", "T2");
  await expect(travel.locator('[data-slot="map-route"]')).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(travel).toHaveCount(0);
  const stopped = await magnification(page);
  await page.waitForTimeout(800);
  expect(await magnification(page)).toBeCloseTo(stopped, 1);

  await page.keyboard.press("]");
  await expect(travel).toHaveAttribute("data-target", "T3");
  await page.keyboard.press("]");
  await expect(travel).toHaveCount(0);
  await expect(nav).toHaveAttribute("data-current", "T3");
  await expect(nav).toHaveAttribute("data-visited", /T3/);
});
