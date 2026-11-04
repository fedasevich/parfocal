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

  const worst = page
    .getByRole("article", { name: "Page 2 of 3" })
    .locator('[data-slot="report-objects-table"]');
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

const titlesOn = (page: Page, name: string) =>
  page
    .getByRole("article", { name })
    .locator("[data-kind]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-title")));

test("the pages split the blocks the way the PDF does", async ({ page }) => {
  await page.goto(url("report"));
  await expect(page.locator('[data-kind="worst-objects"]')).toBeVisible();
  expect(await titlesOn(page, "Page 1 of 3")).toEqual([
    "Results",
    "Cell types, AI against the consensus",
    "Why reviewers disagreed",
    "Opinion answers",
  ]);
  expect(await titlesOn(page, "Page 2 of 3")).toEqual(["Objects, worst first", "Methods"]);
  expect(await titlesOn(page, "Page 3 of 3")).toEqual([]);
  const second = page.getByRole("article", { name: "Page 2 of 3" });
  await expect(second.getByRole("heading", { name: "Signature" })).toBeVisible();
  await expect(second.locator('[data-slot="report-header"]')).toContainText("Evaluation report");
  const third = page.getByRole("article", { name: "Page 3 of 3" });
  await expect(third.getByRole("heading", { name: "Appendix: objects" })).toBeVisible();
  const half = page.locator('[data-kind="disagreement-reasons"]');
  await expect(half).toHaveClass(/col-span-1/);
});

test("every block kind renders on the page or says why it has nothing to show", async ({
  page,
}) => {
  await page.goto(url("arrange"));
  const catalogue = page.getByLabel("Block catalogue");
  await page.getByRole("button", { name: "Select the block Methods" }).click();
  for (const name of [
    "Region metrics per slide",
    "Agreement between reviewers",
    "Per-slide table",
    "Slide figure",
    "Compare two result sets",
  ]) {
    await catalogue.getByRole("button", { name: new RegExp(name) }).click();
  }
  const kinds = [
    "headline-numbers",
    "region-metrics",
    "confusion-matrix",
    "reviewer-agreement",
    "disagreement-reasons",
    "opinion-answers",
    "worst-objects",
    "slide-table",
    "slide-figure",
    "text",
    "comparison",
  ];
  for (const kind of kinds) {
    const block = page.locator(`[data-kind="${kind}"]`).first();
    await expect(block, kind).toBeVisible();
    expect((await block.innerText()).trim().length, kind).toBeGreaterThan(12);
  }
  await expect(page.locator('[data-kind="slide-figure"]')).toContainText(
    "Pick a slide for this figure.",
  );
  await expect(page.locator('[data-kind="comparison"]')).toContainText(
    "Pick a review task to compare with.",
  );
  await expect(page.locator('[data-kind="slide-table"] table')).toBeVisible();
  const ordered = await page
    .locator("[data-kind]")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-kind")));
  expect(new Set(ordered)).toEqual(new Set(kinds));
  await expect(page.getByText(/Arranging · 11 blocks/)).toBeVisible();
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
