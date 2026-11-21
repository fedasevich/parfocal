import { expect, type Page, test } from "./a11y.ts";

const rt14 = "00000000-0000-4000-8007-000000000014";

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("guided review on a 375 pixel phone says it needs a wider screen and does not scroll sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/tasks/${rt14}`);
  await expect(page).toHaveURL(/\/slides\/[^/?]+\?/, { timeout: 20_000 });
  const notice = page.getByTestId("narrow-screen-notice");
  await expect(notice).toContainText("Review needs a wider screen");
  await expect(page.getByTestId("slide-stage")).toHaveCount(0);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1024, height: 812 });
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 20_000,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await notice.getByRole("button", { name: "Back to My work" }).click();
  await expect(page).toHaveURL(/\/my-work/);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});
