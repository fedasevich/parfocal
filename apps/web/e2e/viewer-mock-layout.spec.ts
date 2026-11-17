import { expect, type Page, test } from "./a11y.ts";

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
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=review&as=DH`);
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

  await page.getByRole("button", { name: "Hide the side panel" }).click();
  const tab = page.getByTestId("inspector-tab");
  await expect(tab).toBeVisible();
  const tabBox = await boxOf(page, '[data-testid="inspector-tab"]');
  const header = await boxOf(page, "header");
  expect(tabBox.y).toBeGreaterThanOrEqual(header.y + header.height);
  await tab.click();
  await expect(inspector).toBeVisible();
});

test("the Annotate workspace opens its inspector on Display with the layers", async ({ page }) => {
  await page.goto(`/projects/${p07}/slides/${tumor044}/live?workspace=annotate&as=DH`);
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
