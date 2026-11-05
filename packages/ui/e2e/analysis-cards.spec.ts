import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const staging = (page: Page) => page.locator('[data-slot="staging-cards"]');
const tabs = ["Objects", "Display", "Comments", "Opinion"];

test.use({ viewport: { width: 1280, height: 900 } });

test("the sentinel node template puts the staging cards on top of the tabs", async ({ page }) => {
  await page.goto(story("components-analysis-cards--sentinel-node-staging"));
  await expect(staging(page)).toHaveCount(1);
  await expect(staging(page)).toContainText("Metastasis likely, largest about 7.7 mm");
  await expect(staging(page)).toContainText("Macro if confirmed");
  await expect(staging(page)).toHaveAttribute("data-phase", "open");
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-area", "T1");
  await expect(rows.nth(0)).toContainText("1");
  await expect(rows.nth(0)).toContainText("7.7 mm");
  await expect(rows.nth(0)).toContainText("macro");
  await expect(rows.nth(1)).toContainText("micro");
  await expect(rows.nth(2)).toContainText("ITC");
  const head = await page.locator('[data-slot="side-panel-head"]').boundingBox();
  const headBottom = (head?.y ?? 0) + (head?.height ?? 0);
  const cardTop = (await staging(page).boundingBox())?.y ?? Number.POSITIVE_INFINITY;
  const tabTop = (await page.getByRole("tab", { name: "Objects" }).boundingBox())?.y ?? 0;
  expect(cardTop).toBeLessThan(headBottom);
  expect(headBottom).toBeLessThanOrEqual(tabTop);
});

for (const [name, id] of [
  ["cell review template", "components-analysis-cards--cell-review"],
  ["project without a template", "components-analysis-cards--no-template"],
] as const) {
  test(`the ${name} shows no staging cards and keeps every tab`, async ({ page }) => {
    await page.goto(story(id));
    for (const tab of tabs) await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    await expect(staging(page)).toHaveCount(0);
    await expect(page.locator('[data-slot="staging-hero"]')).toHaveCount(0);
  });
}

test("the staging template with no areas asks for a systematic scan", async ({ page }) => {
  await page.goto(story("components-analysis-cards--staging-without-areas"));
  await expect(staging(page)).toHaveAttribute("data-state", "no-tumor");
  await expect(staging(page)).toContainText("Needs review");
  await expect(staging(page)).toContainText("No tumor flagged");
  await expect(staging(page)).not.toContainText(/negative/i);
  await expect(staging(page).locator('[data-slot="region-row"]')).toHaveCount(0);
  const card = staging(page).locator('[data-slot="no-tumor"]');
  await expect(card).toHaveAttribute("data-coverage", "0");
  await staging(page).getByRole("button", { name: "Start systematic scan" }).click();
  await expect(card).toHaveAttribute("data-scan", "scanning");
  await expect(card).toContainText("Field 1 of 6");
  const first = Number(await card.getAttribute("data-coverage"));
  expect(first).toBeGreaterThan(0);
  await staging(page).getByRole("button", { name: "Next field" }).click();
  await expect(card).toContainText("Field 2 of 6");
  expect(Number(await card.getAttribute("data-coverage"))).toBeGreaterThan(first);
  for (let step = 3; step <= 6; step += 1)
    await staging(page).getByRole("button", { name: "Next field" }).click();
  await expect(card).toHaveAttribute("data-scan", "done");
  await expect(card).toHaveAttribute("data-coverage", "100");
  await staging(page).getByRole("button", { name: "Submit" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-submitted", "yes");
});

test("the open pre-read shows the size scale and starts with area 1", async ({ page }) => {
  await page.goto(story("components-analysis-cards--sentinel-node-staging"));
  const hero = staging(page).locator('[data-slot="staging-hero"]');
  await expect(hero.locator('[data-slot="range-bar"]')).toHaveCount(1);
  await expect(hero).toContainText("0.2 mm");
  await expect(hero).toContainText("2 mm");
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows.nth(1)).toHaveAttribute("data-area", "T2");
  await expect(rows.nth(2)).toHaveAttribute("data-area", "T3");
  await expect(staging(page)).not.toContainText("Cannot change the category");
  await expect(staging(page).getByRole("button", { name: "Submit" })).toHaveCount(0);
  await staging(page).getByRole("button", { name: "Start with area 1" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-started", "T1");
});

test("once area 1 is confirmed and measured the category is settled", async ({ page }) => {
  await page.goto(story("components-analysis-cards--large-deposit-settled"));
  await expect(staging(page)).toHaveAttribute("data-phase", "settled");
  await expect(staging(page)).toContainText("Macrometastasis, 8.0 mm, settled");
  await expect(staging(page)).toContainText("pN1a(sn)");
  await expect(staging(page)).not.toContainText("if confirmed");
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows.nth(0)).toContainText("8.0 mm");
  await expect(rows.nth(0)).toContainText("Sets the category");
  await expect(rows.nth(1)).toContainText("Cannot change the category");
  await expect(rows.nth(2)).toContainText("Cannot change the category");
  await expect(staging(page).getByRole("button", { name: /Start with/ })).toHaveCount(0);
  await staging(page).getByRole("button", { name: "Submit" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-submitted", "yes");
});

test("only a small cluster asks for its size and its tumor cell count", async ({ page }) => {
  await page.goto(story("components-analysis-cards--only-a-small-cluster"));
  await expect(staging(page)).toHaveAttribute("data-state", "small-cluster");
  await expect(staging(page)).toHaveAttribute("data-phase", "open");
  const hero = staging(page).locator('[data-slot="staging-hero"]');
  await expect(hero).toContainText("Small tumor cluster, about 0.18 mm");
  await expect(hero).toContainText("ITC if confirmed");
  await expect(hero).toContainText(
    "both its size and its tumor cell count decide between isolated tumor cells and a micrometastasis",
  );
  await expect(hero).toContainText(
    "To settle it, confirm area 1, measure it and count its tumor cells.",
  );
  const steps = staging(page).locator('[data-slot="cluster-steps"] li');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("Confirm area 1");
  await expect(steps.nth(1)).toContainText("Measure it");
  await expect(steps.nth(2)).toContainText("Count its tumor cells");
  await expect(staging(page).locator('[data-slot="cluster-steps"] [data-done]')).toHaveCount(0);
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows.nth(0)).toHaveAttribute("data-area", "T5");
  await expect(rows.nth(0)).toContainText("0.18 mm");
  await staging(page).getByRole("button", { name: "Start with area 1" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-started", "T5");
});

test("the small cluster step list follows the staging state", async ({ page }) => {
  await page.goto(story("components-analysis-cards--small-cluster-measured"));
  const hero = staging(page).locator('[data-slot="staging-hero"]');
  await expect(hero).toContainText("Small tumor cluster, about 0.17 mm");
  await expect(hero).toContainText("ITC so far");
  await expect(hero).toContainText("To settle it, count its tumor cells.");
  const steps = staging(page).locator('[data-slot="cluster-steps"] li');
  await expect(steps.nth(0)).toHaveAttribute("data-done", "true");
  await expect(steps.nth(0)).toContainText("Area 1 confirmed");
  await expect(steps.nth(1)).toHaveAttribute("data-done", "true");
  await expect(steps.nth(1)).toContainText("Measured 0.17 mm");
  await expect(steps.nth(2)).not.toHaveAttribute("data-done", /.*/);
  await expect(staging(page).getByRole("button", { name: "Submit" })).toHaveCount(0);
});

test("a small cluster with a firm count under 200 settles as isolated tumor cells", async ({
  page,
}) => {
  await page.goto(story("components-analysis-cards--small-cluster-settled"));
  await expect(staging(page)).toHaveAttribute("data-phase", "settled");
  await expect(staging(page)).toContainText("Isolated tumor cells, 0.17 mm, settled");
  await expect(staging(page)).toContainText("pN0(i+)(sn)");
  await expect(staging(page)).toContainText("holds under 200 tumor cells");
  await expect(staging(page).locator('[data-slot="cluster-steps"]')).toHaveCount(0);
  const rows = staging(page).locator('[data-slot="region-row"]');
  await expect(rows.nth(1)).toContainText("Cannot change the category");
  await staging(page).getByRole("button", { name: "Submit" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-submitted", "yes");
});
