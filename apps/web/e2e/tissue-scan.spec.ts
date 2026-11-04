import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openUnflaggedSlide(page: Page) {
  await page.setViewportSize({ width: 320, height: 420 });
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_052" }).click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-coverage", "loaded");
  await expect(stage).toHaveAttribute("data-coverage-basis", "tissue");
  return stage;
}

const percentOf = async (page: Page) =>
  Number(await page.getByTestId("slide-stage").getAttribute("data-coverage-percent"));

test("] steps the systematic scan over the stored tissue mask until coverage is full", async ({
  page,
}) => {
  const stage = await openUnflaggedSlide(page);
  const scan = page.getByTestId("tissue-scan");
  await expect(scan).toHaveAttribute("data-basis", "tissue");
  await expect(page.getByTestId("area-nav")).toHaveCount(0);
  expect(await percentOf(page)).toBe(0);

  await page.keyboard.press("]");
  await expect(scan).toHaveAttribute("data-step", "1");
  await expect(scan).toHaveAttribute("data-arrived", "1");
  const fields = Number(await scan.getAttribute("data-fields"));
  expect(fields).toBeGreaterThanOrEqual(3);
  await expect.poll(() => percentOf(page)).toBeGreaterThan(0);
  expect(await percentOf(page)).toBeLessThan(100);

  for (let step = 2; step <= fields; step += 1) {
    await page.keyboard.press("]");
    await expect(scan).toHaveAttribute("data-step", String(step));
    await expect(scan).toHaveAttribute("data-arrived", String(step));
  }
  await expect.poll(() => percentOf(page), { timeout: 15_000 }).toBe(100);
  await expect(stage).toHaveAttribute("data-coverage-pending", "0", { timeout: 15_000 });
});
