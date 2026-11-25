import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

type Point = { x: number; y: number };

test.use({ viewport: { width: 1440, height: 900 } });

async function openOn(page: Page, object: string) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided&object=${object}`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  await expect(panel).toHaveAttribute("data-current", object);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("outline-editor")).toHaveAttribute("data-editing", object);
  return panel;
}

async function handlesNow(page: Page): Promise<Point[]> {
  const found = page.getByTestId("outline-point");
  await expect(found.first()).toBeVisible();
  const points: Point[] = [];
  for (const handle of await found.all()) {
    const box = await handle.boundingBox();
    if (box !== null) points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return points;
}

async function handles(page: Page): Promise<Point[]> {
  let last = await handlesNow(page);
  for (let turn = 0; turn < 40; turn += 1) {
    await page.waitForTimeout(200);
    const next = await handlesNow(page);
    const still = next.every(
      (point, index) =>
        Math.abs(point.x - (last[index]?.x ?? 0)) < 0.5 &&
        Math.abs(point.y - (last[index]?.y ?? 0)) < 0.5,
    );
    if (still && next.length === last.length) return next;
    last = next;
  }
  throw new Error("The camera did not come to rest");
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

const posted = (page: Page, method: string, ending: string) =>
  page.waitForRequest(
    (request) => request.method() === method && decodeURIComponent(request.url()).endsWith(ending),
  );

test("a reviewer splits a region along a drawn line and undoing the split brings it back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const panel = await openOn(page, "T3");
  const points = await handles(page);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
  const bar = panel.getByTestId("shape-edit-bar");
  await bar.getByRole("button", { name: "Split", exact: true }).click();
  await expect(bar).toHaveAttribute("data-tool", "cut");

  const split = posted(page, "POST", "/edits/T3/split");
  await drag(page, { x: middle, y: Math.min(...ys) - 30 }, { x: middle, y: Math.max(...ys) + 30 });
  const body = (await split).postDataJSON() as { parts: { geometry: { type: string } }[] };
  expect(body.parts).toHaveLength(2);
  expect(body.parts.map((part) => part.geometry.type)).toEqual(["Polygon", "Polygon"]);

  const outlines = page.getByTestId("review-object-outlines");
  await expect(outlines).toHaveAttribute("data-reviewed", "T3a T3b");
  await expect(outlines).toHaveAttribute("data-dimmed", /\bT3\b/);
  const fate = panel.getByTestId("shape-fate-bar");
  await expect(fate).toContainText("T3 is split into T3a, T3b.");

  const cleared = posted(page, "DELETE", "/edits/T3");
  await fate.getByRole("button", { name: "Undo the split" }).click();
  await cleared;
  await expect(outlines).toHaveAttribute("data-reviewed", "");
  await expect(fate).toHaveCount(0);
});

test("a reviewer merges two touching regions and undoing the merge brings both back", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const panel = await openOn(page, "T4");
  const points = await handles(page);
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const scale = (right - left) / 120;
  const toScreen = (x: number, y: number, origin: Point) => ({
    x: origin.x + (x - 180) * scale,
    y: origin.y + (y - 480) * scale,
  });
  const corner = points.reduce((best, point) =>
    point.x + point.y > best.x + best.y ? point : best,
  );
  const origin = { x: corner.x - 120 * scale, y: corner.y - 80 * scale };
  const reshaped = posted(page, "PUT", "/edits/T4");
  await drag(page, corner, toScreen(480, 500, origin));

  const bar = panel.getByTestId("shape-edit-bar");
  await bar.getByRole("button", { name: "Merge", exact: true }).click();
  await reshaped;
  await expect(bar).toHaveAttribute("data-tool", "merge");
  const other = page.locator('[data-testid="ai-object"][data-object="T3"]');
  const view = page.viewportSize() ?? { width: 1440, height: 900 };
  for (let turn = 0; turn < 4; turn += 1) {
    const box = await other.boundingBox();
    const shown = box !== null && box.x > 0 && box.y > 0 && box.x + box.width < view.width * 0.6;
    if (shown) break;
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(600);
  }
  const target = await other.boundingBox();
  if (target === null) throw new Error("T3 is not drawn");
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  const merged = posted(page, "POST", "/merges");
  await bar.getByRole("button", { name: "Merge 2 regions" }).click();
  const body = (await merged).postDataJSON() as { objects: string[]; geometry: { type: string } };
  expect([...body.objects].sort()).toEqual(["T3", "T4"]);
  expect(body.geometry.type).toBe("Polygon");

  const outlines = page.getByTestId("review-object-outlines");
  await expect(outlines).toHaveAttribute("data-reviewed", "T3");
  const fate = panel.getByTestId("shape-fate-bar");
  await expect(fate).toContainText("T4 is merged into T3.");

  const cleared = posted(page, "DELETE", "/edits/T3");
  await fate.getByRole("button", { name: "Undo the merge" }).click();
  await cleared;
  await expect(outlines).toHaveAttribute("data-reviewed", "");
  await expect(fate).toHaveCount(0);
});
