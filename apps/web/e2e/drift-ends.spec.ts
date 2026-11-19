import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const viewer = `/projects/${p07}/slides/${a1}?task=${rt14}`;
const guided = `/tasks/${rt14}/guided?slide=${a1}`;

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(90_000);

async function ready(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  return stage;
}

test("the filter chips wrap inside the panel and a reason reads in words", async ({ page }) => {
  await page.goto(viewer);
  await ready(page);
  const panel = page.getByTestId("stage-inspector");
  const panelBox = (await panel.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const chips = page.getByRole("group", { name: "Show" }).locator("button");
  await expect(chips).toHaveCount(6);
  await expect(chips.nth(5)).toContainText("Added");
  for (const chip of await chips.all()) {
    const box = (await chip.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  }
  const second = page.locator('[data-testid="object-row"][data-object="T2"]');
  await expect(second).toContainText("disagree · boundary is off");
  await expect(second).not.toContainText("boundary_off");
});

test("the Objects tab of a review has no Areas card", async ({ page }) => {
  await page.goto(viewer);
  await ready(page);
  await expect(page.getByTestId("area-nav")).toHaveCount(0);
  await expect(page.getByText("Areas, largest first")).toHaveCount(0);
});

test("guided review ends with Previous and Skip for now, with no Areas, Measurements or grid button", async ({
  page,
}) => {
  await page.goto(guided);
  await ready(page);
  const panel = page.getByTestId("stage-inspector");
  await expect(panel.getByRole("button", { name: "Previous" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Skip for now" })).toBeVisible();
  await expect(page.getByTestId("area-nav")).toHaveCount(0);
  await expect(page.getByTestId("measurement-list")).toHaveCount(0);
  await expect(panel.getByText("Measurements")).toHaveCount(0);
  await expect(panel.getByText("Areas, largest first")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /cells grid/ })).toHaveCount(0);
});

test("the minimap reads its head and both foot texts side by side", async ({ page }) => {
  await page.goto("/settings/layout");
  const choice = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Minimap" })
    .getByRole("radio", { name: "Always" });
  await choice.click();
  await expect(choice).toBeChecked();
  await page.goto(viewer);
  await ready(page);
  const minimap = page.getByTestId("stage-minimap");
  await expect(minimap).toBeVisible();
  await expect(minimap).toContainText("Whole slide");
  const foot = minimap.getByText(/^T\d+ of \d+$/);
  const footEnd = minimap.getByText(/\d+× · \d+ of \d+ decided/);
  await expect(foot).toBeVisible();
  await expect(footEnd).toBeVisible();
  const first = (await foot.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const second = (await footEnd.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const apart =
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y;
  expect(apart).toBe(true);
});

test("a seeded thread without a pin opens its popover at the object", async ({ page }) => {
  await page.goto(`${viewer}&tab=comments`);
  await ready(page);
  const comments = page.getByTestId("stage-comments");
  await expect(page.getByTestId("pin-thread")).toHaveCount(0);
  await comments
    .locator('[data-slot="thread-card"]')
    .filter({ hasText: "T2" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByTestId("pin-thread")).toBeVisible();
});

test("the added region T6⁺ carries a tag on the slide", async ({ page }) => {
  await page.goto(viewer);
  await ready(page);
  const tag = page.getByTestId("region-tag").filter({ hasText: "T6⁺" });
  await expect(tag).toHaveCount(1);
});

test("the shortcuts sheet shows = for zoom in and the cells panel for the cell keys", async ({
  page,
}) => {
  await page.goto("/settings/shortcuts");
  const sheet = page.getByRole("dialog", { name: "Settings" });
  await expect(sheet.getByRole("button", { name: "Zoom in: +" })).toHaveText("=");
  await expect(sheet.getByText("from the selected cell")).toHaveCount(0);
  await expect(sheet.getByText("in the cells panel").first()).toBeVisible();
});
