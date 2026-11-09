import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";

async function openReviewSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  const url = new URL(page.url());
  await page.goto(`${url.pathname}?task=${rt14}`);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
}

test("the engine draws the task objects on the live review slide", async ({ page }) => {
  test.setTimeout(90_000);
  await openReviewSlide(page);
  const layer = page.getByTestId("object-draw-layer");
  await expect(layer).toHaveAttribute("data-draw", "outline");
  await expect
    .poll(async () => Number(await layer.getAttribute("data-objects")))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => Number(await layer.getAttribute("data-overlays")))
    .toBeGreaterThan(0);
});
