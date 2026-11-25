import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const tumor044 = "00000000-0000-4000-8005-000000000005";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page.getByTestId("slide-row").filter({ hasText: "tumor_044" }).click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  await page.getByTestId("stage-inspector").getByRole("tab", { name: "Objects" }).click();
  return page.getByTestId("slide-stage");
}

test("each ruler line joins the measurement list with its value and a time, and can be removed", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const list = page.getByTestId("measurement-list");
  await expect(list).toContainText("Nothing measured yet");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await page.keyboard.press("l");
  const y = box.y + box.height / 2;
  for (const offset of [0, 40]) {
    await page.mouse.move(box.x + 200, y + offset);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, y + offset, { steps: 4 });
    await page.mouse.up();
  }
  const rows = list.getByTestId("measurement-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("M1");
  await expect(rows.nth(1)).toContainText("M2");
  await expect(rows.first().locator("[data-slot=value]")).toHaveText(/^\d+(\.\d+)? (µm|mm)$/);
  await expect(list.getByTestId("measurement-group")).toHaveAttribute("data-group", "Rulers");
  await expect(list.getByRole("heading", { name: "Rulers 2" })).toBeVisible();
  await expect(rows.first().locator("[data-slot=time]")).toHaveText(/^\d\d:\d\d$/);
  await page.getByRole("button", { name: "Remove M1" }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("M2");
});

async function regionInTree(page: Page, label: string) {
  const inspector = page.getByTestId("stage-inspector");
  await inspector.getByRole("tab", { name: "Display" }).click();
  const tree = page.getByTestId("layers-tree");
  const group = tree.locator('[data-key^="c:"]').first();
  await expect(group).not.toContainText("No class");
  if ((await group.getAttribute("data-expanded")) !== "true") {
    await group.getByRole("button", { name: /^Expand / }).click();
  }
  await expect(tree.locator('[data-kind="shape"]')).toHaveCount(1);
  await expect(tree.locator('[data-kind="shape"]')).toContainText(label);
  await expect(tree.getByTestId("layers-row-measure")).toHaveText(
    /^[\d.,\s]+ (µm|mm)² · [\d.,\s]+ (µm|mm)$/,
  );
  await inspector.getByRole("tab", { name: "Objects" }).click();
}

test("in Annotate a drawn region joins the layers tree and the measurement list keeps rulers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=annotate&tab=objects`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.keyboard.press("1");
  const corners = [
    [420, 250],
    [700, 270],
    [680, 520],
    [440, 500],
  ] as const;
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(page.locator("[data-testid=measurement-row][data-kind=area]")).toHaveCount(0);
  await regionInTree(page, "T1⁺");
  const areaList = page.getByTestId("area-nav").getByLabel("Areas, largest first");
  const clipped = await areaList.evaluate((node) => node.scrollHeight > node.clientHeight + 1);
  expect(clipped).toBe(false);
});

test("a ruler and a region keep their numbers on reload, and Clear all asks first", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projects/${p07}/slides/${tumor044}?mode=annotate&tab=objects`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("l");
  await page.mouse.move(box.x + 300, box.y + 600);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 600, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("p");
  await page.keyboard.press("1");
  const corners = [
    [420, 250],
    [700, 270],
    [680, 520],
    [440, 500],
  ] as const;
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
  const list = page.getByTestId("measurement-list");
  const rows = list.getByTestId("measurement-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-kind", "ruler");
  await expect(rows.first()).toContainText("M1");
  await expect(list.getByRole("heading", { level: 3 })).toHaveText(["Rulers 1"]);
  await regionInTree(page, "T1⁺");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 15_000 });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("M1");
  await regionInTree(page, "T1⁺");

  await page.getByTestId("clear-annotations").click();
  const ask = page.getByRole("dialog", { name: /Delete all 2 shapes/ });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId("clear-annotations").click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete all shapes" }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
});
