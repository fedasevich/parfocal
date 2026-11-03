import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const open = (page: Page, name: string) => page.goto(story(`components-inspector-panel--${name}`));
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const count = (page: Page, name: string) => tab(page, name).locator('[data-slot="tab-count"]');
const staging = (page: Page) => page.locator('[data-slot="staging-cards"]');
const templateLine = (page: Page) => page.locator('[data-slot="template-line"]');

test("each of the four tabs shows its own count", async ({ page }) => {
  await open(page, "sentinel-node");
  await expect(count(page, "Objects")).toHaveText("4");
  await expect(count(page, "Display")).toHaveText("3");
  await expect(count(page, "Comments")).toHaveText("2");
  await expect(count(page, "Opinion")).toHaveText("2");
});

test("the four tabs fit the panel at its default width", async ({ page }) => {
  await open(page, "sentinel-node");
  const list = page.locator('[data-slot="tabs-list"]');
  const scrolls = await list.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(scrolls).toBe(false);
});

test("the Objects tab lists the object IDs with their decisions", async ({ page }) => {
  await open(page, "sentinel-node");
  const rows = page.getByRole("list", { name: "Objects" }).getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("T1");
  await expect(rows.nth(0)).toContainText("Agree");
  await expect(rows.nth(1)).toContainText("T2");
  await expect(rows.nth(1)).toContainText("Disagree");
  await expect(rows.nth(2)).toContainText("T3");
  await expect(rows.nth(2)).toContainText("Still open");
});

test("the Display tab holds the result sets with their colours and versions", async ({ page }) => {
  await open(page, "sentinel-node");
  await tab(page, "Display").click();
  const sets = page.getByLabel("Result sets");
  await expect(sets).toContainText("CAMELYON v1.0");
  await expect(sets).toContainText("TumorScan v2");
  await expect(sets).toContainText("Run here 13 Oct");
  await expect(sets).toContainText("Your review");
  await expect(sets.getByRole("switch", { name: "TumorScan v2" })).not.toBeChecked();
});

test("the Comments tab lists the open threads by anchor and keeps resolved ones apart", async ({
  page,
}) => {
  await open(page, "sentinel-node");
  await tab(page, "Comments").click();
  const cards = page.locator('[data-slot="thread-card"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("T2");
  await expect(cards.nth(0)).toContainText("Looks like a lymphoid aggregate");
  await expect(cards.nth(1)).toContainText("T1");
  await expect(page.getByText("Check the scanner artefact")).toHaveCount(0);
});

test("the Opinion tab holds the form and its answers", async ({ page }) => {
  await open(page, "sentinel-node");
  await tab(page, "Opinion").click();
  const card = page.locator('[data-slot="slide-done-card"]');
  await expect(card).toContainText("2 left on slide 8");
  await expect(card).toContainText("How sure are you of the overall call?");
  await expect(card).toContainText("Would you send this slide for a second read?");
});

test("the counts follow a decision, a new result set, a resolved thread and an answer", async ({
  page,
}) => {
  await open(page, "sentinel-node");
  await page.getByRole("button", { name: "Remove the last object" }).click();
  await expect(count(page, "Objects")).toHaveText("3");
  await page.getByRole("button", { name: "Add a result set" }).click();
  await expect(count(page, "Display")).toHaveText("4");
  await page.getByRole("button", { name: "Resolve the first thread" }).click();
  await expect(count(page, "Comments")).toHaveText("1");
  await tab(page, "Opinion").click();
  await page.getByRole("radio", { name: "Yes" }).click();
  await expect(count(page, "Opinion")).toHaveText("1");
  await page.getByRole("radio", { name: "4" }).click();
  await expect(count(page, "Opinion")).toHaveCount(0);
});

test("the sentinel node template names itself and shows the staging cards", async ({ page }) => {
  await open(page, "sentinel-node");
  await expect(templateLine(page)).toHaveAttribute("data-template", "sentinel-node");
  await expect(templateLine(page)).toContainText("Sentinel node staging");
  await expect(staging(page)).toHaveCount(1);
  await expect(page.locator('[data-slot="staging-hero"]')).toHaveCount(1);
  await expect(staging(page).locator('[data-slot="region-row"]')).toHaveCount(4);
});

test("a project without a template says so and shows no staging", async ({ page }) => {
  await open(page, "no-template");
  await expect(templateLine(page)).toHaveAttribute("data-template", "none");
  await expect(templateLine(page)).toHaveText("No analysis template");
  await expect(staging(page)).toHaveCount(0);
  await expect(page.locator('[data-slot="staging-hero"]')).toHaveCount(0);
  for (const name of ["Objects", "Display", "Comments", "Opinion"])
    await expect(tab(page, name)).toBeVisible();
});

test("the cell review template names itself and shows no staging", async ({ page }) => {
  await open(page, "cell-review");
  await expect(templateLine(page)).toContainText("Cell review");
  await expect(staging(page)).toHaveCount(0);
});
