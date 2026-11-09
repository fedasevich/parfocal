import { expect, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const emptySlide = "00000000-0000-4000-8005-000000000007";

test("a slide with no tumor flagged scans the tissue one field at a time", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${emptySlide}?task=${rt14}`);
  const staging = page.locator('[data-slot="staging-cards"]');
  await expect(staging).toHaveAttribute("data-state", "no-tumor", { timeout: 20_000 });
  await expect(staging).toContainText("Needs review");
  await expect(staging).not.toContainText(/negative/i);
  const card = staging.locator('[data-slot="no-tumor"]');
  await expect(card).toHaveAttribute("data-coverage", "0");
  await staging.getByRole("button", { name: "Start systematic scan" }).click();
  await expect(card).toContainText(/Field 1 of \d+/);
  await expect(page.getByText("10×", { exact: true }).first()).toBeVisible();
  const first = Number(await card.getAttribute("data-coverage"));
  await staging.getByRole("button", { name: "Next field" }).click();
  await expect(card).toContainText(/Field 2 of \d+/);
  await page.locator("body").press("]");
  await expect(card).toContainText(/Field 3 of \d+/);
  expect(Number(await card.getAttribute("data-coverage"))).toBeGreaterThanOrEqual(first);
});
