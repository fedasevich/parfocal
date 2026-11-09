import { readFileSync } from "node:fs";
import type { Page } from "./a11y.ts";
import { expect, test } from "./telemetry-capture.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const p03 = "00000000-0000-4000-8003-000000000003";

const budgets = JSON.parse(
  readFileSync(new URL("../../../perf-budgets.json", import.meta.url), "utf8"),
) as { budgets: { id: string; limit: number }[] };

const fittedLimitMs = budgets.budgets.find((entry) => entry.id === "viewer.fitted-ms")?.limit ?? 0;

async function expectFitted(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  const fittedMs = Number(await stage.getAttribute("data-fitted-ms"));
  expect(fittedMs).toBeGreaterThan(0);
  expect(fittedMs).toBeLessThanOrEqual(fittedLimitMs);
  await expect(stage.locator("canvas")).toHaveCount(1);
}

test("a slide row on the project page opens the slide fitted with its case loaded and no patient in a research project", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\/live$/);
  await expectFitted(page);
  const header = page.getByTestId("case-header");
  await expect(header).toContainText("tumor_044");
  await expect(header).toContainText("result set");
  await expect(page.getByTestId("patient-banner")).toHaveCount(0);
});

test("the Open button of a slide in My work opens the slide fitted", async ({ page }) => {
  await page.goto("/my-work?tab=all");
  await page.getByRole("row", { name: /tumor_044/ }).click();
  await page
    .getByRole("complementary", { name: "Preview of tumor_044" })
    .getByRole("button", { name: /^Open(?! in the full)/ })
    .click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/slides\/[0-9a-f-]+\/live/);
  await expectFitted(page);
  await expect(page.getByTestId("case-header")).toContainText("tumor_044");
});

test("a slide of a case in a clinical project shows its patient", async ({ page }) => {
  await page.goto(`/projects/${p03}?tab=slides`);
  await page.getByTestId("slide-row").first().click();
  await expectFitted(page);
  await expect(page.getByTestId("case-header")).toBeVisible();
  await expect(page.getByTestId("patient-banner")).toBeVisible();
});
