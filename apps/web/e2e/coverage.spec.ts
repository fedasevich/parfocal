import { expect, type Page, test } from "./a11y.ts";

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
  test.setTimeout(60_000);
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

test("the viewed ring shows the coverage share and opens the whole slide peek", async ({
  page,
}) => {
  const stage = await openSlide(page);
  await expect.poll(() => seenOf(page)).toBeGreaterThan(0);
  const ring = page.getByTestId("viewed-ring");
  const percent = await stage.getAttribute("data-coverage-percent");
  await expect(ring).toHaveAttribute("data-percent", percent ?? "");
  await expect(ring).toContainText(percent ?? "");

  await ring.click();
  const peek = page.getByTestId("viewed-peek");
  await expect(peek).toBeVisible();
  await expect(peek).toContainText(`${percent}% of the tissue seen at 10x or more`);
  await expect(peek.locator("[data-slot=viewed-cells]")).toHaveAttribute(
    "data-cells",
    String(await seenOf(page)),
  );

  await page.keyboard.press("Escape");
  await expect(peek).toBeHidden();
});
