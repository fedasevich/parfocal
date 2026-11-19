import { expect, type Page, test } from "./a11y.ts";

test.describe.configure({ timeout: 150_000 });
test.use({ viewport: { width: 1440, height: 900 } });

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const cellsSlide = "00000000-0000-4000-8005-000000000008";
const rt14 = "00000000-0000-4000-8007-000000000014";

async function chooseTools(page: Page, label: "Left rail" | "Bottom dock") {
  await page.goto("/settings/layout");
  const group = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Tools" });
  await group.getByRole("radio", { name: label }).click();
  await expect(group.getByRole("radio", { name: label })).toBeChecked();
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  return box;
}

async function stageReady(page: Page) {
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
  const box = await stage.boundingBox();
  if (!box) throw new Error("No stage box");
  return box;
}

async function expectTopRight(page: Page, area: { x: number; y: number; width: number }) {
  const bar = await boxOf(page, '[data-slot="magnification-bar"]');
  expect(Math.abs(bar.y - (area.y + 12))).toBeLessThanOrEqual(1);
  expect(Math.abs(bar.x + bar.width - (area.x + area.width - 12))).toBeLessThanOrEqual(1);
  return bar;
}

test("the docked viewer puts the magnification bar at the top right and keeps it usable", async ({
  page,
}) => {
  await chooseTools(page, "Bottom dock");
  await page.goto(`/projects/${p07}/slides/${cellsSlide}?task=${rt14}`);
  const area = await stageReady(page);
  const barBefore = await expectTopRight(page, area);
  const dock = await boxOf(page, '[data-slot="stage-tools"]');
  expect(barBefore.y + barBefore.height).toBeLessThan(dock.y);

  await page
    .getByTestId("stage-review-objects")
    .getByRole("button", { name: "Show the cells" })
    .click();
  const grid = page.getByTestId("stage-cells-grid");
  await expect(grid).toBeVisible();
  const gridBox = await boxOf(page, '[data-testid="stage-cells-grid"]');
  const bar = page.getByTestId("magnification-bar");
  const barBox = await bar.boundingBox();
  if (!barBox) throw new Error("No bar box");
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(gridBox.y);

  await bar.hover();
  await bar.getByRole("button", { name: "10×", exact: true }).click();
  await expect(bar.getByRole("button", { name: "10×", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the docked annotate workspace puts the magnification bar at the top right", async ({
  page,
}) => {
  await chooseTools(page, "Bottom dock");
  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=annotate&as=LM`);
  const area = await stageReady(page);
  await expectTopRight(page, area);
  const bar = page.getByTestId("magnification-bar");
  await bar.hover();
  await bar.getByRole("button", { name: "10×", exact: true }).click();
  await expect(bar.getByRole("button", { name: "10×", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

for (const layout of ["Left rail", "Bottom dock"] as const) {
  test(`Whole slide sits level with the bar row in ${layout}`, async ({ page }) => {
    await chooseTools(page, layout);
    await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=review&as=LM`);
    const area = await stageReady(page);
    await page.getByTestId("sample-chip").click();
    const whole = page.getByTestId("whole-slide-button");
    await expect(whole).toBeVisible();
    const button = await whole.boundingBox();
    if (!button) throw new Error("No button box");
    expect(Math.abs(button.x - (area.x + 16))).toBeLessThanOrEqual(1);
    expect(Math.abs(button.y + button.height - (area.y + area.height - 16))).toBeLessThanOrEqual(1);
    if (layout === "Left rail") {
      const bar = await boxOf(page, '[data-slot="magnification-bar"]');
      const barMiddle = bar.y + bar.height / 2;
      const buttonMiddle = button.y + button.height / 2;
      expect(Math.abs(barMiddle - buttonMiddle)).toBeLessThanOrEqual(6);
    } else {
      const dock = await boxOf(page, '[data-slot="stage-tools"]');
      expect(button.x + button.width).toBeLessThan(dock.x);
    }
  });
}

test("the docked compare screen keeps the Linked pill above the dock", async ({ page }) => {
  await chooseTools(page, "Bottom dock");
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await page.goto((await link.getAttribute("href")) ?? "");
  await page.getByRole("button", { name: /^A1/ }).first().click();
  await page
    .getByRole("dialog", { name: "Slides in this case and task" })
    .getByRole("button", { name: /Side by side with/ })
    .first()
    .click();
  await expect(page).toHaveURL(/scene=picked/);
  const pill = page.getByText("Linked: pan, zoom and rotation move both").locator("..");
  await expect(pill).toBeVisible();
  const pillBox = await pill.boundingBox();
  const dock = await boxOf(page, '[data-slot="tool-rail"]');
  if (!pillBox) throw new Error("No pill box");
  expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(dock.y);
});

test("the dock is 48 px tall with 36 px tools", async ({ page }) => {
  await chooseTools(page, "Bottom dock");
  await page.goto(`/projects/${p07}/slides/${a1}/live?task=${rt14}&workspace=review&as=LM`);
  await stageReady(page);
  const dock = await boxOf(page, '[data-slot="stage-tools"]');
  expect(Math.round(dock.height)).toBe(48);
  expect(Math.abs(Math.round(dock.width) - 271)).toBeLessThanOrEqual(2);
  const tool = await boxOf(page, '[data-slot="stage-tools"] [data-slot="tool-rail-button"]');
  expect(Math.round(tool.width)).toBe(36);
  expect(Math.round(tool.height)).toBe(36);
});
