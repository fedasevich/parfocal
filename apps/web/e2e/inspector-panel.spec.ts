import { expect, type Page, test } from "@playwright/test";

const panel = (page: Page) => page.getByRole("complementary", { name: "Side panel" });
const handle = (page: Page) => page.getByRole("separator", { name: "Resize the side panel" });
const tab = (page: Page) => page.getByTestId("inspector-tab");

async function openViewer(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  await link.click();
  await expect(page.getByTestId("full-viewer")).toBeVisible();
  await expect(panel(page)).toBeVisible();
}

async function widthOf(page: Page) {
  const box = await panel(page).boundingBox();
  return Math.round(box?.width ?? 0);
}

async function dragTo(page: Page, targetX: number) {
  const box = await handle(page).boundingBox();
  if (!box) throw new Error("no resize handle");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 6 });
  await page.mouse.up();
}

test("the panel opens at 340 and a drag resizes it between 280 and 560", async ({ page }) => {
  await openViewer(page);
  expect(await widthOf(page)).toBe(340);
  const viewport = page.viewportSize()?.width ?? 1280;
  await dragTo(page, viewport - 450);
  expect(await widthOf(page)).toBe(450);
  await dragTo(page, viewport - 900);
  expect(await widthOf(page)).toBe(560);
  await dragTo(page, viewport - 250);
  expect(await widthOf(page)).toBe(280);
  await dragTo(page, viewport - 240);
  expect(await widthOf(page)).toBe(280);
});

test("dragging below 220 hides the panel, a floating tab names the section and brings it back", async ({
  page,
}) => {
  await openViewer(page);
  const viewport = page.viewportSize()?.width ?? 1280;
  await dragTo(page, viewport - 150);
  await expect(panel(page)).toHaveCount(0);
  await expect(tab(page)).toContainText("Objects");
  await expect(tab(page)).toContainText(/\d/);
  await tab(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(tab(page)).toHaveCount(0);
});

test("I and the rail button hide and restore the panel", async ({ page }) => {
  await openViewer(page);
  await page.keyboard.press("i");
  await expect(panel(page)).toHaveCount(0);
  await expect(tab(page)).toBeVisible();
  await page.keyboard.press("i");
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: /^Hide the side panel/ }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show the side panel (I)", exact: true }).click();
  await expect(panel(page)).toBeVisible();
});

test("the width and the hidden state survive a reload", async ({ page }) => {
  await openViewer(page);
  const viewport = page.viewportSize()?.width ?? 1280;
  await dragTo(page, viewport - 420);
  await page.reload();
  await expect(panel(page)).toBeVisible();
  expect(await widthOf(page)).toBe(420);
  await page.keyboard.press("i");
  await page.reload();
  await expect(panel(page)).toHaveCount(0);
  await expect(tab(page)).toBeVisible();
});

test("the arrow keys resize the focused handle", async ({ page }) => {
  await openViewer(page);
  await handle(page).focus();
  await page.keyboard.press("ArrowLeft");
  expect(await widthOf(page)).toBe(360);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(await widthOf(page)).toBe(320);
});

test("hide while panning fades the panel only during a drag on the slide", async ({ page }) => {
  await openViewer(page);
  await page.getByLabel("Hide while panning").check();
  const dock = page.getByTestId("inspector-dock");
  await expect(dock).not.toHaveAttribute("data-hidden-while-panning", "true");
  const stage = page.locator("[data-vt-target]");
  const box = await stage.boundingBox();
  if (!box) throw new Error("no slide area");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await expect(dock).toHaveAttribute("data-hidden-while-panning", "true");
  await page.mouse.up();
  await expect(dock).not.toHaveAttribute("data-hidden-while-panning", "true");
});
