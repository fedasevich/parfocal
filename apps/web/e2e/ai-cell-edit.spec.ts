import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";
const tumor = "00000000-0000-4000-8021-000000000001";
const lymphocyte = "00000000-0000-4000-8021-000000000002";
const mitosis = "00000000-0000-4000-8021-000000000003";

test.use({ viewport: { width: 1440, height: 900 } });

type Box = { x: number; y: number; width: number; height: number };

async function openTaskSlide(page: Page) {
  await page.goto(`/projects/${p07}/slides/${withResults}?task=${annotateTask}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(page.getByTestId("ai-object")).toHaveCount(6);
  return stage;
}

const cell = (page: Page, object: string) =>
  page.locator(`[data-testid="ai-object"][data-object="${object}"]`);

async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("The cell is not on screen");
  return box;
}

const middle = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

async function settled(page: Page, object: string): Promise<Box> {
  let last = await boxOf(cell(page, object));
  for (let turn = 0; turn < 40; turn += 1) {
    await page.waitForTimeout(150);
    const next = await boxOf(cell(page, object));
    if (Math.abs(next.x - last.x) < 0.5 && Math.abs(next.width - last.width) < 0.5) return next;
    last = next;
  }
  throw new Error("The camera did not come to rest");
}

async function cellsAreInView(page: Page, stage: Locator) {
  const frame = await boxOf(stage);
  for (const object of ["C1", "C6"]) {
    const box = await settled(page, object);
    expect(box.x).toBeGreaterThan(frame.x + 20);
    expect(box.y).toBeGreaterThan(frame.y + 20);
    expect(box.x + box.width).toBeLessThan(frame.x + frame.width - 20);
    expect(box.y + box.height).toBeLessThan(frame.y + frame.height - 20);
    expect(box.width).toBeGreaterThan(24);
  }
}

async function clickCell(page: Page, object: string) {
  const at = middle(await boxOf(cell(page, object)));
  await page.mouse.click(at.x, at.y);
  await expect(cell(page, object)).toHaveAttribute("data-selected", "true");
}

async function lassoAround(page: Page, objects: readonly string[]) {
  const boxes = await Promise.all(objects.map((object) => boxOf(cell(page, object))));
  const pad = 8;
  const left = Math.min(...boxes.map((box) => box.x)) - pad;
  const top = Math.min(...boxes.map((box) => box.y)) - pad;
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + pad;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad;
  await page.keyboard.down("Alt");
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(right, top, { steps: 6 });
  await page.mouse.move(right, bottom, { steps: 6 });
  await page.mouse.move(left, bottom, { steps: 6 });
  await page.mouse.move(left, top + 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

test("an expert retypes one seeded cell by key and several by lasso, reshapes one, deletes one, and a reload keeps it all", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stage = await openTaskSlide(page);
  await page.keyboard.press("v");
  await cellsAreInView(page, stage);
  await page.keyboard.press("j");
  await expect(cell(page, "C1")).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("j");
  await expect(cell(page, "C4")).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Shift+j");
  await expect(cell(page, "C1")).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ai-selection")).toHaveCount(0);
  const selection = page.getByTestId("ai-selection");
  const row = (object: string) => page.getByRole("button", { name: new RegExp(`^${object}\\b`) });

  await expect(cell(page, "C1")).toHaveAttribute("data-class", tumor);
  await clickCell(page, "C1");
  await expect(page.getByTestId("ai-tag")).toContainText("Tumor cell");
  await page.keyboard.press("3");
  await expect(cell(page, "C1")).toHaveAttribute("data-class", mitosis);
  await expect(page.getByTestId("ai-notice")).toContainText("1 cell is now Mitosis");
  await expect(row("C1")).toHaveAttribute("data-origin", "ai-edited");

  await lassoAround(page, ["C4", "C5", "C6"]);
  await expect(selection).toHaveAttribute("data-count", "3");
  const chips = page.getByTestId("type-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.filter({ hasText: "Lymphocyte" })).toContainText("2");
  await page.keyboard.press("1");
  await expect(page.getByTestId("ai-notice")).toContainText("2 cells are now Tumor cell");
  for (const object of ["C4", "C5", "C6"]) {
    await expect(cell(page, object)).toHaveAttribute("data-class", tumor);
  }
  await expect(row("C6")).toHaveAttribute("data-origin", "ai-edited");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(cell(page, "C4")).toHaveAttribute("data-class", lymphocyte);
  await expect(cell(page, "C6")).toHaveAttribute("data-class", lymphocyte);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(cell(page, "C4")).toHaveAttribute("data-class", tumor);
  await expect(cell(page, "C6")).toHaveAttribute("data-class", tumor);

  await clickCell(page, "C2");
  await page.keyboard.press("Enter");
  const handles = page.getByTestId("ai-handle");
  await expect(handles).toHaveCount(4);
  const before = await boxOf(cell(page, "C2"));
  const corner = middle(await boxOf(handles.first()));
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x - 20, corner.y - 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("ai-ghost")).toBeVisible();
  await expect(row("C2")).toHaveAttribute("data-origin", "ai-edited");
  const after = await boxOf(cell(page, "C2"));
  expect(after.width).toBeGreaterThan(before.width + 10);
  await page.keyboard.press("Escape");

  await clickCell(page, "C3");
  await page.keyboard.press("x");
  await expect(page.getByTestId("ai-object")).toHaveCount(5);
  await expect(row("C3")).toHaveAttribute("data-origin", "ai-edited");
  await expect(selection).toHaveCount(0);

  await page.reload();
  await expect(stage).toHaveAttribute("data-annotations", "loaded", { timeout: 20_000 });
  await expect(page.getByTestId("ai-object")).toHaveCount(5);
  await expect(cell(page, "C3")).toHaveCount(0);
  await expect(cell(page, "C1")).toHaveAttribute("data-class", mitosis);
  for (const object of ["C4", "C5", "C6"]) {
    await expect(cell(page, object)).toHaveAttribute("data-class", tumor);
  }
  await expect(cell(page, "C2")).toHaveAttribute("data-check", "edited");
  await row("C2").click();
  const ghost = await boxOf(page.getByTestId("ai-ghost"));
  const reshaped = await boxOf(cell(page, "C2"));
  expect(reshaped.width).toBeGreaterThan(ghost.width + 14);

  await page.getByTestId("ai-restore").click();
  await expect(page.getByTestId("ai-notice")).toContainText("The AI original is back");
  await expect
    .poll(async () => (await boxOf(cell(page, "C2"))).width)
    .toBeLessThan(ghost.width + 10);
  await expect(cell(page, "C2")).toHaveAttribute("data-class", lymphocyte);
});
