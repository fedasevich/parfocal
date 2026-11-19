import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const groupsKey = "parfocal.fake.layer-groups";

type Box = { x: number; y: number };

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  return { stage, box };
}

async function drawRectangle(page: Page, box: Box, from: [number, number], to: [number, number]) {
  const stage = page.getByTestId("slide-stage");
  if ((await stage.getAttribute("data-tool")) !== "rectangle") await page.keyboard.press("r");
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 5 });
  await page.mouse.up();
}

const rowOf = (page: Page, name: string) =>
  page.getByTestId("layers-panel").locator("li", { hasText: name });

const selected = (page: Page) => page.getByTestId("select-layer");

async function savedGroups(page: Page) {
  return page.evaluate((key) => sessionStorage.getItem(key) ?? "", groupsKey);
}

async function reloaded(page: Page) {
  await page.reload();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-annotations", "loaded", {
    timeout: 15_000,
  });
}

test("groups are saved, renamed, recoloured, filled, ungrouped, deleted and restored", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  await drawRectangle(page, box, [200, 200], [400, 260]);
  await drawRectangle(page, box, [500, 200], [700, 260]);
  await drawRectangle(page, box, [200, 400], [400, 460]);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);

  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 230);
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 600, box.y + 230);
  await page.keyboard.up("Shift");
  await expect(selected(page)).toHaveAttribute("data-selected", /^\d+,\d+$/);
  await page.keyboard.press("Control+g");
  await expect(rowOf(page, "Group 1")).toContainText("2");
  await expect(rowOf(page, "Ungrouped")).toContainText("1");

  await page.getByRole("button", { name: "New shapes go to Group 1" }).dblclick();
  await expect(page.getByText("click a layer name to change")).toHaveCount(0);
  await page.getByLabel("Name of Group 1").pressSequentially("Margins");
  await page.keyboard.press("Enter");
  await expect(rowOf(page, "Margins")).toHaveCount(1);

  await page.getByRole("button", { name: "New shapes go to Margins" }).focus();
  await page.keyboard.press("F2");
  await page.getByLabel("Name of Margins").pressSequentially("Margin cells");
  await page.keyboard.press("Enter");
  await expect(rowOf(page, "Margin cells")).toHaveCount(1);

  await page.getByLabel("Colour of Margin cells").fill("#00ff00");
  await expect(rowOf(page, "Margin cells").locator("i").first()).toHaveCSS(
    "background-color",
    "rgb(0, 255, 0)",
  );

  await page.keyboard.press("Escape");
  await page.mouse.click(box.x + 300, box.y + 430);
  await expect(selected(page)).toHaveAttribute("data-selected", /^\d+$/);
  await page.getByTestId("layers-move").click();
  await page.getByRole("menuitem", { name: "Margin cells" }).click();
  await expect(rowOf(page, "Margin cells")).toContainText("3");
  await expect(rowOf(page, "Ungrouped")).toHaveCount(0);

  await expect.poll(() => savedGroups(page)).toContain("Margin cells");
  await expect.poll(() => savedGroups(page)).toContain("[0,255,0]");
  await reloaded(page);
  await expect(rowOf(page, "Margin cells")).toContainText("3");
  await expect(rowOf(page, "Ungrouped")).toHaveCount(0);
  await expect(rowOf(page, "Margin cells").locator("i").first()).toHaveCSS(
    "background-color",
    "rgb(0, 255, 0)",
  );

  await page.getByRole("button", { name: "More actions for Margin cells" }).click();
  await page.getByRole("menuitem", { name: "Ungroup" }).click();
  await expect(rowOf(page, "Margin cells")).toHaveCount(0);
  await expect(rowOf(page, "Ungrouped")).toContainText("3");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);
  await page.keyboard.press("Control+z");
  await expect(rowOf(page, "Margin cells")).toContainText("3");

  await page.getByRole("button", { name: "More actions for Margin cells" }).click();
  await page.getByRole("menuitem", { name: "Delete group" }).click();
  await expect(rowOf(page, "Margin cells")).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(rowOf(page, "Margin cells")).toContainText("3");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);

  await expect.poll(() => savedGroups(page)).toContain("Margin cells");
  await reloaded(page);
  await expect(rowOf(page, "Margin cells")).toContainText("3");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(3);
});

test("an empty layer is removed and a locked target says where the shape went", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  await page.getByRole("button", { name: "Add a layer" }).click();
  await expect(rowOf(page, "Layer 1")).toHaveCount(1);
  await page.getByRole("button", { name: "New shapes go to Layer 1" }).click();
  await page.getByRole("button", { name: "Lock Layer 1" }).click();
  await drawRectangle(page, box, [200, 200], [400, 260]);
  await expect(page.getByTestId("layers-skipped")).toContainText("Layer 1 is locked");
  await expect(page.getByTestId("layers-skipped")).toContainText("Ungrouped");
  await expect(rowOf(page, "Ungrouped")).toContainText("1");

  await page.getByRole("button", { name: "More actions for Layer 1" }).click();
  await page.getByRole("menuitem", { name: "Delete group" }).click();
  await expect(rowOf(page, "Layer 1")).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
});
