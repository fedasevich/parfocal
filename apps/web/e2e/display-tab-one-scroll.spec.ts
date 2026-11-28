import type {} from "../src/debug-handle.ts";
import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const annotationsKey = "parfocal.fake.annotations";
const classIds = {
  stroma: `${p07}-class-2`,
  immune: `${p07}-class-3`,
} as const;

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 90_000 });

async function seedCells(page: Page) {
  await page.addInitScript(
    ({ key, slide, ids }) => {
      if (sessionStorage.getItem(key) !== null) return;
      const stamp = new Date(0).toISOString();
      const cells = Array.from({ length: 30 }, (_, index) => ({
        id: `00000000-0000-4000-9000-${String(index).padStart(12, "0")}`,
        slide_id: slide,
        kind: "cell",
        number: index + 21,
        code: `T${index + 21}`,
        geometry: { type: "Point", coordinates: [3000 + (index % 10) * 300, 3000 + index * 40] },
        class_id: index < 15 ? ids.immune : ids.stroma,
        text: null,
        task_id: null,
        version: 1,
        created_by_user_id: null,
        created_at: stamp,
        updated_at: stamp,
        deleted_at: null,
      }));
      sessionStorage.setItem(key, JSON.stringify({ [slide]: cells }));
    },
    { key: annotationsKey, slide: tumor044, ids: classIds },
  );
}

async function openDisplay(page: Page) {
  await seedCells(page);
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 25_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 15_000 });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  await expect(page.getByTestId("layers-tree")).toBeVisible();
  return stage;
}

const tree = (page: Page) => page.getByTestId("layers-tree");
const group = (page: Page, name: string) =>
  tree(page).locator('li[data-kind="group"]', { hasText: name });
const caret = (page: Page, name: string, state: "Collapse" | "Expand") =>
  group(page, name).getByRole("button", { name: new RegExp(`^${state} `) });

test("one scroll, collapse keeps the selection, the slide reveals, Alt folds a level", async ({
  page,
}) => {
  const stage = await openDisplay(page);
  await caret(page, "Immune", "Expand").click();
  await expect(tree(page)).toHaveAttribute("data-rows", "17");
  const scrollers = await page.getByTestId("stage-inspector").evaluate((aside) => {
    const found: string[] = [];
    for (const node of aside.querySelectorAll("*")) {
      const { overflowY } = window.getComputedStyle(node);
      const scrolls = overflowY === "auto" || overflowY === "scroll";
      if (scrolls && node.scrollHeight > node.clientHeight) found.push(node.tagName);
    }
    return found;
  });
  expect(scrollers).toHaveLength(1);

  const cell = tree(page).locator('li[data-kind="shape"]').first();
  await cell.getByTestId("layers-row-name").click();
  await expect(cell).toHaveAttribute("data-selected", "true");
  const selected = await page.getByTestId("select-layer").getAttribute("data-selected");

  await caret(page, "Immune", "Collapse").click();
  await expect(group(page, "Immune")).toHaveAttribute("data-expanded", "false");
  await expect(group(page, "Immune")).toHaveAttribute("data-holds-selection", "true");
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", selected ?? "");

  await caret(page, "Immune", "Expand").click();
  await expect(tree(page).locator('li[data-kind="shape"][data-selected="true"]')).toHaveCount(1);
  await caret(page, "Immune", "Collapse").click();
  await expect(group(page, "Stroma")).toHaveAttribute("data-expanded", "false");

  const groups = tree(page).locator('li[data-kind="group"]');
  const opened = tree(page).locator('li[data-kind="group"][data-expanded="true"]');
  await caret(page, "Immune", "Expand").click({ modifiers: ["Alt"] });
  await expect(groups.and(page.locator('[data-expanded="false"]'))).toHaveCount(0);
  await caret(page, "Immune", "Collapse").click({ modifiers: ["Alt"] });
  await expect(opened).toHaveCount(0);

  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 260, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(opened).toHaveCount(0);

  await page.keyboard.press("v");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.mouse.click(box.x + 300, box.y + 230);
  await expect(opened.first()).toBeVisible();
  const picked = tree(page).locator('li[data-kind="shape"][data-selected="true"]');
  await expect(picked).toHaveCount(1);
  await expect(picked).toBeInViewport();
});

test("the cell list is tall and its rows show the size without truncation", async ({ page }) => {
  await openDisplay(page);
  await caret(page, "Immune", "Expand").click();
  const inspector = await page.getByTestId("stage-inspector").boundingBox();
  const rows = tree(page).locator('li[data-kind="shape"]');
  await expect(tree(page)).toHaveAttribute("data-rows", "17");
  const list = await tree(page).boundingBox();
  expect(list?.height ?? 0).toBeGreaterThan((inspector?.height ?? 0) / 2);
  const measure = rows.first().getByTestId("layers-row-measure");
  const truncated = await measure.evaluate((node) => node.scrollWidth > node.clientWidth);
  expect(truncated).toBe(false);
});

test("the input help collapses, hides, stays hidden after a reload and comes back", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("parfocal.device-settings", JSON.stringify({ device: "trackpad" }));
  });
  await openDisplay(page);
  const legend = page.getByTestId("device-legend");
  await expect(legend).toContainText("Trackpad");
  await legend.getByTestId("device-legend-collapse").click();
  await expect(legend).toHaveAttribute("data-fold", "collapsed");
  await legend.getByTestId("device-legend-hide").click();
  await expect(legend).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-annotations", "loaded", {
    timeout: 25_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Display" }).click();
  await expect(page.getByTestId("device-legend")).toHaveCount(0);
  await page.getByTestId("device-legend-show").click();
  await expect(page.getByTestId("device-legend")).toBeVisible();
});
