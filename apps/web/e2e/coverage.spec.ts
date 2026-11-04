import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-coverage", "loaded");
  return stage;
}

const seenOf = async (page: Page) =>
  Number(await page.getByTestId("slide-stage").getAttribute("data-coverage-seen"));

test("seen cells reach the server in batches and come back after a reload", async ({ page }) => {
  const stage = await openSlide(page);
  await expect.poll(() => seenOf(page)).toBeGreaterThan(0);
  await expect(stage).toHaveAttribute("data-coverage-pending", "0", { timeout: 15_000 });
  const seen = await seenOf(page);
  const percent = await stage.getAttribute("data-coverage-percent");
  expect(Number(percent)).toBeGreaterThan(0);

  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-coverage", "loaded");
  await expect(stage).toHaveAttribute("data-coverage-pending", "0");
  await expect(stage).toHaveAttribute("data-coverage-seen", String(seen));
  await expect(stage).toHaveAttribute("data-coverage-percent", percent ?? "");
});
