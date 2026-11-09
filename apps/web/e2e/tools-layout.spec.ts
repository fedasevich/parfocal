import { expect, type Page, test } from "./a11y.ts";

test.describe.configure({ timeout: 150_000 });

const reviewTask = "00000000-0000-4000-8007-000000000014";
const p07 = "00000000-0000-4000-8003-000000000007";

async function chooseTools(page: Page, label: "Left rail" | "Bottom dock") {
  await page.goto("/settings/layout");
  const group = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("radiogroup", { name: "Tools" });
  await group.getByRole("radio", { name: label }).click();
  await expect(group.getByRole("radio", { name: label })).toBeChecked();
}

async function hrefOf(page: Page, name: string) {
  await page.goto("/prototype");
  const link = page.getByRole("list", { name: "Screens" }).getByRole("link", { name, exact: true });
  const href = (await link.getAttribute("href")) ?? "";
  return new URL(href, "http://localhost").pathname;
}

const boxOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  return box;
};

async function expectDocked(page: Page, area: string) {
  const dock = await boxOf(page, '[data-slot="tool-rail"]');
  const stage = await boxOf(page, area);
  expect(dock.width).toBeGreaterThan(dock.height * 4);
  expect(Math.round(dock.y + dock.height)).toBe(Math.round(stage.y + stage.height - 14));
  const dockMiddle = dock.x + dock.width / 2;
  const stageMiddle = stage.x + stage.width / 2;
  expect(Math.abs(dockMiddle - stageMiddle)).toBeLessThan(2);
  return dock;
}

for (const layout of ["Left rail", "Bottom dock"] as const) {
  test(`Review lays the tools out as ${layout}`, async ({ page }) => {
    await chooseTools(page, layout);
    const path = await hrefOf(page, "Full viewer · Objects tab");
    await page.goto(`${path}?task=${reviewTask}`);
    await expect(page.getByTestId("full-viewer")).toBeVisible({ timeout: 45_000 });
    const viewer = page.getByTestId("full-viewer");
    await expect(viewer).toHaveAttribute("data-tools", layout === "Left rail" ? "rail" : "dock");
    const rail = await boxOf(page, '[data-slot="tool-rail"]');
    const bar = await boxOf(page, '[data-slot="magnification-bar"]');
    if (layout === "Left rail") {
      expect(rail.height).toBeGreaterThan(rail.width * 4);
      expect(Math.round(rail.x)).toBe(0);
      expect(bar.y + bar.height).toBeGreaterThan(rail.y);
      return;
    }
    const dock = await expectDocked(page, '[data-vt-target=""]');
    expect(bar.y + bar.height).toBeLessThanOrEqual(dock.y);
    await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: /Pan/ }).click();
    await expect(page).toHaveURL(/tool=hand/);
  });

  test(`Annotate lays the tools out as ${layout}`, async ({ page }) => {
    await chooseTools(page, layout);
    const path = await hrefOf(page, "Annotate workspace · Auto region");
    await page.goto(path);
    await expect(page.getByTestId("full-viewer")).toBeVisible({ timeout: 45_000 });
    const rail = await boxOf(page, '[data-slot="tool-rail"]');
    const context = await boxOf(page, '[data-slot="context-bar"]');
    const bar = await boxOf(page, '[data-slot="magnification-bar"]');
    if (layout === "Left rail") {
      expect(rail.height).toBeGreaterThan(rail.width * 4);
      const origin = await boxOf(page, '[data-vt-target=""]');
      expect(Math.round(context.y - origin.y)).toBe(12);
      return;
    }
    const dock = await expectDocked(page, '[data-vt-target=""]');
    const area = await boxOf(page, '[data-vt-target=""]');
    expect(Math.round(context.y - area.y)).toBe(72);
    expect(bar.y + bar.height).toBeLessThanOrEqual(dock.y);
  });
}

test("the real slide stage docks its tools and lifts the magnification bar", async ({ page }) => {
  await chooseTools(page, "Bottom dock");
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(stage).toHaveAttribute("data-tools", "dock");
  const tools = await boxOf(page, '[data-slot="stage-tools"]');
  const magnification = await boxOf(page, '[data-slot="stage-magnification"]');
  const area = await stage.boundingBox();
  expect(tools.width).toBeGreaterThan(tools.height * 4);
  expect(Math.round(tools.y + tools.height)).toBe(
    Math.round((area?.y ?? 0) + (area?.height ?? 0) - 14),
  );
  expect(magnification.y + magnification.height).toBeLessThanOrEqual(tools.y);
  await page.locator('button[data-tool="rect"]').click();
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
});
