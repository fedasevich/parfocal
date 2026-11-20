import { expect, type Page, test } from "./a11y.ts";
import { hidePanelWhilePanning } from "./parts.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";

test.use({ viewport: { width: 1440, height: 900 } });

const cards = ["area-nav", "measurement-list", "view-map", "painted-map", "count-panel"];

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  return box;
}

test("the live viewer docks its rail and inspector beside the slide like the mock", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=look&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector.getByRole("tab", { name: "Objects" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByTestId("area-nav")).toBeVisible();
  await expect(inspector.getByTestId("measurement-list")).toBeVisible();

  const rail = await boxOf(page, '[data-slot="tool-rail"]');
  const canvas = await boxOf(page, '[data-testid="slide-stage"]');
  const panel = await boxOf(page, '[data-testid="stage-inspector"]');
  expect(rail.x + rail.width).toBeLessThanOrEqual(canvas.x + 1);
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x + 1);
  expect(rail.width).toBeLessThanOrEqual(56);

  for (const card of cards) {
    await expect(stage.getByTestId(card)).toHaveCount(0);
  }

  await inspector.getByRole("tab", { name: "Display" }).click();
  await expect(inspector.getByTestId("view-map")).toBeVisible();
  await expect(inspector.getByTestId("painted-map")).toBeVisible();
  await expect(stage.getByTestId("area-nav")).toHaveCount(0);

  await page.keyboard.press("i");
  const tab = page.getByTestId("inspector-tab");
  await expect(tab).toBeVisible();
  const tabBox = await boxOf(page, '[data-testid="inspector-tab"]');
  const header = await boxOf(page, "header");
  expect(tabBox.y).toBeGreaterThanOrEqual(header.y + header.height);
  await tab.click();
  await expect(inspector).toBeVisible();
});

test("the Annotate workspace opens its inspector on Display with the layers", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=annotate&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const inspector = page.getByTestId("stage-inspector");
  await expect(inspector.getByRole("tab", { name: "Display" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(inspector.getByTestId("layers-panel")).toBeVisible();
  await inspector.getByRole("tab", { name: "Objects" }).click();
  await expect(inspector.getByTestId("measurement-list")).toBeVisible();
  await expect(stage.getByTestId("measurement-list")).toHaveCount(0);
});

test("the live top bar has the slide picker and progress, and the inspector keeps its three tabs and the open tab across a reload", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=look&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const bar = page.getByTestId("live-top-bar");
  await expect(bar.getByRole("link", { name: "My work" })).toBeVisible();
  await expect(bar.getByTestId("slide-progress")).toContainText(/Slide \d+ of \d+/);
  await bar.getByTestId("slide-picker").click();
  const rows = page.locator('[data-slot="slide-row"]');
  await expect(rows.filter({ hasText: "tumor_044" })).toHaveCount(1);
  expect(await rows.count()).toBeGreaterThan(1);
  await page.keyboard.press("Escape");

  const inspector = page.getByTestId("stage-inspector");
  for (const name of ["Objects", "Display", "Comments"]) {
    await expect(inspector.getByRole("tab", { name })).toBeVisible();
  }
  await expect(inspector.getByRole("tab", { name: /^Opinion/ })).toHaveCount(0);
  await inspector.getByRole("tab", { name: "Comments" }).click();
  await expect(page).toHaveURL(/tab=comments/);
  await expect(inspector.getByTestId("stage-comments")).toBeVisible();
  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(inspector.getByRole("tab", { name: "Comments" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await bar.getByTestId("mode-switch").getByRole("radio", { name: "Annotate" }).click();
  await expect(stage).toHaveAttribute("data-workspace", "annotate");
  await expect(inspector.getByRole("tab", { name: "Comments" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await bar.getByTestId("slide-picker").click();
  await rows.filter({ hasNotText: "tumor_044" }).first().click();
  await expect(page).not.toHaveURL(new RegExp(tumor044));
  await expect(page).toHaveURL(/tab=comments/);
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(inspector.getByRole("tab", { name: "Comments" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("hide while panning hides the live inspector during a pan and not on a click", async ({
  page,
}) => {
  await hidePanelWhilePanning(page, "DH");
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=look&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  const dock = page.getByTestId("inspector-dock");
  const box = await boxOf(page, '[data-testid="slide-stage"]');
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await expect(dock).not.toHaveAttribute("data-hidden-while-panning", "true");
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 8 });
  await expect(dock).toHaveAttribute("data-hidden-while-panning", "true");
  await page.mouse.up();
  await expect(dock).not.toHaveAttribute("data-hidden-while-panning", "true");
});

test("the save status sits in the top bar and the tool chips sit in the context bar", async ({
  page,
}) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=annotate&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await page.keyboard.press("s");
  await expect(stage).toHaveAttribute("data-tool", "smart");
  const toggle = page.getByTestId("smart-hover-toggle");
  await expect(page.getByTestId("context-bar").getByTestId("smart-hover-toggle")).toBeVisible();
  await expect(toggle).toHaveCount(1);
  await expect(stage.getByTestId("save-status")).toHaveCount(0);
});
