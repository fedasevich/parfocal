import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const url = (scene: string) => `/tasks/${rt14}/evaluation?scene=${scene}`;

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

const violationsOf = async (page: Page) => {
  const results = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .exclude("[data-base-ui-focus-guard]")
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
};

test("the seeded report shows its header, pages and the sentinel node blocks", async ({ page }) => {
  await page.goto(url("report"));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Round 2");
  await expect(page.getByText("Research output").first()).toBeVisible();
  await expect(page.getByText(/Evaluation v1 · signed/).first()).toBeVisible();
  await expect(page.getByText(/· 3 pages/)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(3);

  const first = page.getByRole("article", { name: "Page 1 of 3" });
  await expect(first.getByRole("heading", { name: "Why reviewers disagreed" })).toBeVisible();
  await expect(first.getByText("Cells agreed")).toBeVisible();

  const matrix = first.locator('[data-slot="confusion-matrix"]');
  await expect(matrix.getByText("The AI said", { exact: true })).toBeVisible();
  await expect(matrix.getByText("Consensus of the reviewers", { exact: true })).toBeVisible();

  const counts = await first
    .locator('[data-slot="count-bars"]')
    .first()
    .locator("span.font-mono")
    .allTextContents();
  const numbers = counts.map(Number);
  expect(numbers.length).toBeGreaterThan(1);
  expect(numbers).toEqual([...numbers].sort((a, b) => b - a));

  const worst = first.locator('[data-slot="report-objects-table"]');
  const headers = await worst.locator("thead th").allTextContents();
  expect(headers.length).toBeGreaterThan(3);
  expect(headers.slice(3).every((name) => name.trim().length > 0)).toBe(true);
});

test("the side panel offers the template, the PDF preview, arrange and the downloads", async ({
  page,
}) => {
  await page.goto(url("report"));
  await expect(page.getByRole("combobox", { name: "Template" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Format" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview the PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arrange blocks and format" })).toBeVisible();
  await expect(
    page.getByRole("complementary").getByRole("button", { name: "Download", exact: true }).last(),
  ).toBeVisible();
});

for (const scene of ["report", "arrange", "pdf", "retiredtpl", "exportfail"]) {
  test(`the ${scene} scene passes axe`, async ({ page }) => {
    await page.goto(url(scene));
    await expect(page.getByRole("article").first()).toBeVisible();
    await page.evaluate(() =>
      Promise.race([
        Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]),
    );
    expect(await violationsOf(page)).toEqual([]);
  });
}
