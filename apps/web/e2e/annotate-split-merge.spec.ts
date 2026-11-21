import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const annotateTask = "00000000-0000-4000-8007-000000000021";
const withResults = "00000000-0000-4000-8005-000000000005";

type Box = { x: number; y: number; width: number; height: number };

type Batch = {
  changes: { object: string; geometry?: unknown; deleted?: boolean }[];
  added?: { kind: string }[];
  removed?: { id: string }[];
};

test.use({ viewport: { width: 1440, height: 900 } });

const cell = (page: Page, object: string) =>
  page.locator(`[data-testid="ai-object"][data-object="${object}"]`);

async function boxOf(target: Locator): Promise<Box> {
  const box = await target.boundingBox();
  if (box === null) throw new Error("The cell is not on screen");
  return box;
}

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

async function openTaskSlide(page: Page) {
  await page.goto(`/projects/${p07}/slides/${withResults}?task=${annotateTask}&as=DH`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 40_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(page.getByTestId("ai-object")).toHaveCount(6);
  await page.keyboard.press("v");
  return settled(page, "C1");
}

async function clickCell(page: Page, object: string, adding = false) {
  const box = await boxOf(cell(page, object));
  if (adding) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (adding) await page.keyboard.up("Shift");
  await expect(cell(page, object)).toHaveAttribute("data-selected", "true");
}

const batch = (page: Page) =>
  page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/shared-layer/ai-changes"),
  );

test("an expert splits an AI cell along a drawn line in one batch and undo brings it back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const before = await openTaskSlide(page);
  await clickCell(page, "C1");
  const tools = page.getByTestId("split-merge");
  await tools.getByRole("button", { name: "Split", exact: true }).click();
  await expect(page.locator('[data-testid="brush-layer"][data-cut="true"]')).toBeVisible();

  const split = batch(page);
  const middle = before.x + before.width / 2;
  await page.mouse.move(middle, before.y - 20);
  await page.mouse.down();
  await page.mouse.move(middle, before.y + before.height + 20, { steps: 16 });
  await page.mouse.up();
  const sent = (await split).postDataJSON() as Batch;
  expect(sent.changes.map((change) => change.object)).toEqual(["C1"]);
  expect(sent.added?.map((part) => part.kind)).toEqual(["cell"]);
  await expect(page.getByTestId("ai-notice")).toContainText("C1 is split into 2 parts");
  await expect
    .poll(async () => (await boxOf(cell(page, "C1"))).width)
    .toBeLessThan(before.width * 0.7);

  const undone = batch(page);
  await page.keyboard.press("ControlOrMeta+z");
  const back = (await undone).postDataJSON() as Batch;
  expect(back.changes.map((change) => change.object)).toEqual(["C1"]);
  expect(back.removed).toHaveLength(1);
  await expect
    .poll(async () => (await boxOf(cell(page, "C1"))).width)
    .toBeGreaterThan(before.width * 0.95);
});

test("an expert merges two touching AI cells in one batch and undo brings both back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const first = await openTaskSlide(page);
  await clickCell(page, "C1");
  await page.keyboard.press("Enter");
  const handles = page.getByTestId("ai-handle");
  await expect(handles).toHaveCount(4);
  const corners = [];
  for (const handle of await handles.all()) {
    const box = await boxOf(handle);
    corners.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  const far = corners.reduce((best, point) => (point.x + point.y > best.x + best.y ? point : best));
  const scale = first.width / 50;
  const reshaped = batch(page);
  await page.mouse.move(far.x, far.y);
  await page.mouse.down();
  await page.mouse.move(far.x + 65 * scale, far.y + 55 * scale, { steps: 8 });
  await page.mouse.up();
  await reshaped;
  await page.keyboard.press("Escape");

  await clickCell(page, "C1");
  await clickCell(page, "C2", true);
  const merged = batch(page);
  await page.getByTestId("split-merge").getByRole("button", { name: "Merge 2 objects" }).click();
  const sent = (await merged).postDataJSON() as Batch;
  const byObject = new Map(sent.changes.map((change) => [change.object, change]));
  expect(byObject.get("C1")?.geometry).toBeTruthy();
  expect(byObject.get("C1")?.deleted).toBe(false);
  expect(byObject.get("C2")?.deleted).toBe(true);
  await expect(page.getByTestId("ai-notice")).toContainText("2 objects merged into C1");

  const undone = batch(page);
  await page.keyboard.press("ControlOrMeta+z");
  const back = (await undone).postDataJSON() as Batch;
  expect(new Map(back.changes.map((change) => [change.object, change.deleted])).get("C2")).toBe(
    false,
  );
});
