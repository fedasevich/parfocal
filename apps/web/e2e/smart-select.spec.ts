import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSmart(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await page.keyboard.press("s");
  await expect(stage).toHaveAttribute("data-tool", "smart");
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  return { stage, centre };
}

const layer = (page: Page) => page.getByTestId("smart-layer");
const proposals = (page: Page) => page.getByTestId("proposal-layer");

async function settled(page: Page) {
  await expect(layer(page)).toHaveAttribute("data-phase", "ready");
}

test("a click is a positive point and shows one proposal with Accept and Discard", async ({
  page,
}) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await expect(layer(page)).toHaveAttribute("data-negatives", "0");
  await expect(layer(page)).toHaveAttribute("data-live", "1");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
  await expect(page.getByTestId("smart-positive")).toHaveCount(1);
  await expect(page.getByTestId("context-bar")).toHaveAttribute("data-mode", "proposals");
  await expect(page.getByTestId("proposal-accept")).toBeVisible();
  await expect(page.getByTestId("proposal-discard")).toBeVisible();
});

test("Shift+click extends the same object", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 12, centre.y);
  await page.keyboard.up("Shift");
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-kept", "0");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("right-click and Alt+click are negative points", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.mouse.click(centre.x + 6, centre.y, { button: "right" });
  await expect(layer(page)).toHaveAttribute("data-negatives", "1");
  await settled(page);
  await page.keyboard.down("Alt");
  await page.mouse.click(centre.x - 6, centre.y);
  await page.keyboard.up("Alt");
  await expect(layer(page)).toHaveAttribute("data-negatives", "2");
  await expect(page.getByTestId("smart-negative")).toHaveCount(2);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("a drag is a box prompt", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.move(centre.x - 30, centre.y - 20);
  await page.mouse.down();
  await page.mouse.move(centre.x + 30, centre.y + 20, { steps: 5 });
  await expect(page.getByTestId("smart-box-preview")).toHaveCount(1);
  await page.mouse.up();
  await settled(page);
  await expect(layer(page)).toHaveAttribute("data-box", "1");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("a plain click keeps the object and starts another", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x - 80, centre.y);
  await settled(page);
  await page.mouse.click(centre.x + 80, centre.y);
  await expect(layer(page)).toHaveAttribute("data-kept", "1");
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "2");
});

test("Backspace removes the last point and then the box", async ({ page }) => {
  const { centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.down("Shift");
  await page.mouse.click(centre.x + 10, centre.y);
  await page.keyboard.up("Shift");
  await expect(layer(page)).toHaveAttribute("data-points", "2");
  await settled(page);
  await page.keyboard.press("Backspace");
  await expect(layer(page)).toHaveAttribute("data-points", "1");
  await settled(page);
  await page.keyboard.press("Backspace");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(proposals(page)).toHaveCount(0);
});

test("Enter accepts the proposal as a shape and the next click starts a new session", async ({
  page,
}) => {
  const { stage, centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(proposals(page)).toHaveCount(0);
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  await page.mouse.click(centre.x + 100, centre.y + 40);
  await settled(page);
  await expect(proposals(page)).toHaveAttribute("data-proposals", "1");
});

test("Escape discards the proposal and keeps the tool", async ({ page }) => {
  const { stage, centre } = await openSmart(page);
  await page.mouse.click(centre.x, centre.y);
  await settled(page);
  await page.keyboard.press("Escape");
  await expect(proposals(page)).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-tool", "smart");
  await expect(layer(page)).toHaveAttribute("data-points", "0");
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});
