import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

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

async function selectBoth(page: Page, box: Box) {
  await page.keyboard.press("v");
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 760, box.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", /\S/);
}

async function twoGrouped(page: Page) {
  const opened = await openSlide(page);
  await drawRectangle(page, opened.box, [200, 200], [400, 260]);
  await drawRectangle(page, opened.box, [500, 200], [700, 260]);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
  await selectBoth(page, opened.box);
  await page.keyboard.press("Control+g");
  return opened;
}

const rowOf = (page: Page, name: string) =>
  page.getByTestId("layers-panel").locator("li", { hasText: name });

test("Cmd+G groups the selection into a row with its count and Cmd+Shift+G ungroups it", async ({
  page,
}) => {
  await twoGrouped(page);
  const row = rowOf(page, "Group 1");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("2");
  await expect(rowOf(page, "Ungrouped")).toHaveCount(0);

  await page.keyboard.press("Control+Shift+g");
  await expect(rowOf(page, "Group 1")).toHaveCount(0);
  await expect(rowOf(page, "Ungrouped")).toContainText("2");
});

test("the eye hides a group and its shapes leave the slide and come back", async ({ page }) => {
  await twoGrouped(page);
  await page.getByRole("button", { name: "Hide Group 1" }).click();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await expect(rowOf(page, "Group 1")).toHaveAttribute("data-hidden", "true");
  await page.getByRole("button", { name: "Show Group 1" }).click();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
});

test("a hidden or locked group cannot be picked on the slide", async ({ page }) => {
  const { box } = await twoGrouped(page);
  const selected = page.getByTestId("select-layer");
  await page.keyboard.press("Escape");
  await expect(selected).toHaveAttribute("data-selected", "");

  await page.getByRole("button", { name: "Lock Group 1" }).click();
  await expect(rowOf(page, "Group 1")).toHaveAttribute("data-locked", "true");
  await page.mouse.click(box.x + 300, box.y + 230);
  await expect(selected).toHaveAttribute("data-selected", "");

  await page.getByRole("button", { name: "Unlock Group 1" }).click();
  await page.mouse.click(box.x + 300, box.y + 230);
  await expect(selected).toHaveAttribute("data-selected", /\S/);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Hide Group 1" }).click();
  await page.mouse.click(box.x + 300, box.y + 230);
  await expect(selected).toHaveAttribute("data-selected", "");
});

test("A shows and hides every overlay", async ({ page }) => {
  await twoGrouped(page);
  const panel = page.getByTestId("layers-panel");
  await page.keyboard.press("a");
  await expect(panel).toHaveAttribute("data-overlays", "hidden");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await page.keyboard.press("a");
  await expect(panel).toHaveAttribute("data-overlays", "shown");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
});

test("Group by class turns loose shapes into class groups", async ({ page }) => {
  const { box } = await openSlide(page);
  await drawRectangle(page, box, [200, 200], [400, 260]);
  await expect(rowOf(page, "Ungrouped")).toContainText("1");
  await page.getByRole("radio", { name: "class" }).click();
  await expect(rowOf(page, "Ungrouped")).toHaveCount(0);
  await expect(page.getByTestId("layers-panel").locator("li")).toHaveCount(1);
});

test("new shapes go to the layer you pick and the target is refused once it is locked", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  const panel = page.getByTestId("layers-panel");
  await page.getByRole("button", { name: "Add a layer" }).click();
  await expect(rowOf(page, "Layer 1")).toHaveCount(1);
  await page.getByRole("button", { name: "New shapes go to Layer 1" }).click();
  await expect(panel).toHaveAttribute("data-target", "1");

  await drawRectangle(page, box, [200, 200], [400, 260]);
  await expect(rowOf(page, "Layer 1")).toContainText("1");
  await expect(rowOf(page, "Ungrouped")).toHaveCount(0);

  await page.getByRole("button", { name: "Lock Layer 1" }).click();
  await expect(panel).toHaveAttribute("data-target", "");
  await expect(page.getByTestId("layers-target")).toContainText("hidden or locked");
});

test("a colour picked for a layer shows on its row", async ({ page }) => {
  await twoGrouped(page);
  await page.getByLabel("Colour of Group 1").fill("#00ff00");
  await expect(rowOf(page, "Group 1").locator("i").first()).toHaveCSS(
    "background-color",
    "rgb(0, 255, 0)",
  );
});
