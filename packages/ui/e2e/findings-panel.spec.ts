import { expect, type Page, test } from "@playwright/test";

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story&globals=a11y.manual:!true`;
const open = (page: Page, name: string) => page.goto(story(`components-findings-panel--${name}`));
const panel = (page: Page) => page.locator('[data-slot="findings-panel"]');
const slot = (page: Page, name: string) => page.locator(`[data-slot="${name}"]`);
const zoneRows = (page: Page) =>
  page.getByRole("list", { name: "Zones where the AI is unsure" }).getByRole("listitem");
const sections = (page: Page) =>
  panel(page).evaluate((node) =>
    Array.from(node.children).map((child) => child.getAttribute("data-slot")),
  );
const steps = (page: Page) => slot(page, "step-block");

test.use({ viewport: { width: 1280, height: 900 } });

test("with nothing selected it shows the slide's number line, zones and scattered cells", async ({
  page,
}) => {
  await open(page, "nothing-selected");
  await expect(panel(page)).toHaveAttribute("data-layout", "cell-findings");
  await expect(slot(page, "findings-number-line")).toContainText("This slide");
  await expect(zoneRows(page)).toHaveCount(2);
  await expect(slot(page, "findings-scattered").locator('[data-slot="gallery-tile"]')).toHaveCount(
    5,
  );
  await expect(slot(page, "findings-outline")).toHaveCount(0);
  await expect(slot(page, "findings-changed")).toHaveCount(0);
  await expect(slot(page, "model-warnings")).toHaveCount(0);
  expect(await sections(page)).toEqual([
    "findings-number-line",
    "findings-zones",
    "findings-scattered",
    "findings-extras",
    "findings-hover",
  ]);
});

test("the zones are listed most unsure first with their numbers", async ({ page }) => {
  await open(page, "nothing-selected");
  await expect(zoneRows(page).nth(0)).toContainText("Zone 2 · Possibly not cells");
  await expect(zoneRows(page).nth(0)).toContainText("26 unsure of 80 cells (33%), 20 open");
  await expect(zoneRows(page).nth(1)).toContainText("Zone 1 · Models disagree");
});

test("hovering a zone on the slide shows its numbers", async ({ page }) => {
  await open(page, "nothing-selected");
  await expect(slot(page, "findings-hover")).toContainText("zone-2");
  await expect(slot(page, "findings-hover")).toContainText("26 unsure of 80 cells");
});

test("the extras are collapsed rows that open on a click", async ({ page }) => {
  await open(page, "nothing-selected");
  const row = slot(page, "findings-extras").locator('[data-slot="folding-zone"]').first();
  await expect(row).toContainText("Track record");
  await expect(page.getByText("Measured on slides checked by reviewers.")).toBeHidden();
  await row.getByRole("button").click();
  await expect(page.getByText("Measured on slides checked by reviewers.")).toBeVisible();
});

test("a zone opens to its number line and gallery, and goes back to the list", async ({ page }) => {
  await open(page, "nothing-selected");
  await zoneRows(page).nth(0).getByRole("button").click();
  await expect(slot(page, "findings-number-line")).toContainText("Zone 2 · Possibly not cells");
  await expect(slot(page, "findings-gallery").locator('[data-slot="gallery-tile"]')).toHaveCount(8);
  await expect(slot(page, "findings-zones")).toHaveCount(0);
  await expect(slot(page, "findings-scattered")).toHaveCount(0);
  await expect(slot(page, "findings-extras")).toHaveCount(0);
  await page.getByRole("button", { name: /Back to the list/ }).click();
  await expect(zoneRows(page)).toHaveCount(2);
});

test("picking a tile shows the cell, the AI call and the zone's tiles with no type buttons", async ({
  page,
}) => {
  await open(page, "zone-open");
  await slot(page, "findings-gallery").locator('[data-slot="gallery-tile"]').nth(2).click();
  const cell = slot(page, "findings-cell");
  await expect(cell).toContainText("Cell C23");
  await expect(cell).toContainText("on the slide");
  await expect(cell.getByRole("img", { name: "Crop of C23" })).toBeVisible();
  await expect(cell.locator('[data-slot="ai-call"]')).not.toBeEmpty();
  await expect(cell.getByRole("button")).toHaveCount(0);
  const siblings = slot(page, "findings-siblings").locator('[data-slot="gallery-tile"]');
  await expect(siblings).toHaveCount(8);
  await expect(slot(page, "findings-number-line")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /^(Tumor|Stroma|Immune)$/ })).toHaveCount(0);
  await siblings.nth(4).click();
  await expect(cell).toContainText("Cell C25");
  await page.getByRole("button", { name: /Back to Zone 2/ }).click();
  await expect(slot(page, "findings-gallery")).toBeVisible();
});

test("a selected cell opens straight to the cell view", async ({ page }) => {
  await open(page, "cell-selected");
  expect(await sections(page)).toEqual(["back-link", "findings-cell", "findings-siblings"]);
});

test("a scattered cell shows no zone tiles and goes back to the list", async ({ page }) => {
  await open(page, "nothing-selected");
  await slot(page, "findings-scattered").locator('[data-slot="gallery-tile"]').first().click();
  await expect(slot(page, "findings-cell")).toContainText("Cell S1");
  await expect(slot(page, "findings-siblings")).toHaveCount(0);
  await page.getByRole("button", { name: /Back to the list/ }).click();
  await expect(zoneRows(page)).toHaveCount(2);
});

test("a drawn outline shows only its own number line", async ({ page }) => {
  await open(page, "outline-selected");
  await expect(slot(page, "findings-number-line")).toContainText("R1 · Invasive front");
  await expect(slot(page, "findings-zones")).toHaveCount(0);
  await page.getByRole("button", { name: /Back to the list/ }).click();
  await expect(slot(page, "findings-outline")).toContainText("Invasive front");
  await slot(page, "findings-outline").getByRole("button").click();
  await expect(slot(page, "findings-number-line")).toContainText("R1 · Invasive front");
});

test("after learning the changed zone is listed, opens to its cells and can be undone", async ({
  page,
}) => {
  await open(page, "after-learning");
  const zone = slot(page, "findings-changed");
  await expect(zone).toContainText("Changed after your corrections");
  await zone.locator('[data-slot="findings-zone-row"]').click();
  await expect(slot(page, "findings-gallery").locator('[data-slot="gallery-tile"]')).toHaveCount(6);
  await page.getByRole("button", { name: /Back to the list/ }).click();
  await zone.getByRole("button", { name: "Undo" }).click();
  await expect(zone).toHaveCount(0);
  await expect(zoneRows(page)).toHaveCount(2);
});

test("the model warning bar leads both layouts and is absent without a warning", async ({
  page,
}) => {
  await open(page, "cell-findings-warned");
  expect((await sections(page))[0]).toBe("model-warnings");
  await expect(slot(page, "model-warnings")).toContainText("not calibrated");
  await open(page, "node-staging-warned");
  expect((await sections(page))[0]).toBe("model-warnings");
  await open(page, "node-staging");
  await expect(panel(page)).toBeVisible();
  await expect(slot(page, "model-warnings")).toHaveCount(0);
});

test("node staging states each area's role and shows the size scale", async ({ page }) => {
  await open(page, "node-staging");
  await expect(panel(page)).toHaveAttribute("data-layout", "node-staging");
  const areas = slot(page, "findings-area");
  await expect(areas).toHaveCount(2);
  await expect(areas.nth(0).locator('[data-slot="findings-area-role"]')).toHaveText(
    "Sets the category",
  );
  await expect(areas.nth(1).locator('[data-slot="findings-area-role"]')).toHaveText(
    "Can't change the category",
  );
  await expect(areas.nth(0).locator('[data-slot="range-bar"]')).toBeVisible();
  await expect(areas.nth(1).locator('[data-slot="range-bar"]')).toHaveCount(0);
});

test("a large area is worked in two steps, in order", async ({ page }) => {
  await open(page, "node-staging");
  await expect(steps(page)).toHaveCount(2);
  await expect(steps(page).nth(0)).toContainText("1 · Is it tumor?");
  await expect(steps(page).nth(1)).toContainText("2 · How big is it?");
  await expect(steps(page).nth(1)).toContainText("Opens after step 1.");
  await steps(page)
    .nth(0)
    .getByRole("button", { name: /^Tumor/ })
    .click();
  await expect(steps(page).nth(0)).toHaveAttribute("data-done", "true");
  await steps(page).nth(1).getByRole("button", { name: "Measure it" }).click();
  await expect(steps(page).nth(1)).toContainText("6.4 mm");
  await expect(steps(page).nth(1)).toHaveAttribute("data-done", "true");
});

test("a cluster near 0.2 mm asks for the tumor cell count as a third step", async ({ page }) => {
  await open(page, "node-staging-small-cluster");
  await expect(steps(page)).toHaveCount(3);
  await expect(steps(page).nth(2)).toContainText("3 · How many tumor cells?");
  await steps(page)
    .nth(0)
    .getByRole("button", { name: /^Tumor/ })
    .click();
  await steps(page).nth(1).getByRole("button", { name: "Measure it" }).click();
  await expect(steps(page).nth(2)).toContainText("150 to 240");
  await steps(page).nth(2).getByRole("button", { name: "Count the tumor cells" }).click();
  await expect(steps(page).nth(2)).toContainText("164 tumor cells");
});

test("an area called not tumor is dropped and asks nothing more", async ({ page }) => {
  await open(page, "node-staging-small-cluster");
  await steps(page)
    .nth(0)
    .getByRole("button", { name: /^Not tumor/ })
    .click();
  await expect(steps(page)).toHaveCount(1);
  await expect(
    slot(page, "findings-area").nth(1).locator('[data-slot="findings-area-role"]'),
  ).toHaveText("Dropped from the report");
});

test("picking another area moves the steps to it", async ({ page }) => {
  await open(page, "node-staging");
  await slot(page, "findings-area").nth(1).getByRole("button", { expanded: false }).click();
  await expect(steps(page)).toHaveCount(3);
  await expect(slot(page, "findings-area").nth(0).locator('[data-slot="range-bar"]')).toHaveCount(
    0,
  );
});
