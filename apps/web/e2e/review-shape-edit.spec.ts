import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

type Body = {
  class_id: string | null;
  geometry: { type: string; coordinates: number[][][] } | null;
};

test.use({ viewport: { width: 1440, height: 900 } });

async function openGuided(page: Page, extra = "") {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided${extra}`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  return panel;
}

const blur = (page: Page) =>
  page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

const edit = (page: Page, method: string, object: string) =>
  page.waitForRequest(
    (request) =>
      request.method() === method && decodeURIComponent(request.url()).endsWith(`/edits/${object}`),
  );

const areaOf = (body: Body) => {
  const ring = body.geometry?.coordinates[0] ?? [];
  let sum = 0;
  for (let index = 0; index + 1 < ring.length; index++) {
    const [ax = 0, ay = 0] = ring[index] ?? [];
    const [bx = 0, by = 0] = ring[index + 1] ?? [];
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) / 2;
};

async function handleBoxes(page: Page) {
  const handles = page.getByTestId("ai-handle");
  await expect(handles.first()).toBeVisible();
  const boxes = [];
  for (const handle of await handles.all()) {
    const box = await handle.boundingBox();
    if (box !== null) boxes.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return boxes;
}

const centreOf = (points: readonly { x: number; y: number }[]) => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function historyCount(page: Page) {
  return page.getByTestId("object-edit-history").getByRole("listitem").count();
}

test("a reviewer moves a point, paints, erases and restores the AI outline, one edit each", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const panel = await openGuided(page);
  const object = (await panel.getAttribute("data-current")) ?? "";
  await blur(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ai-layer")).toHaveAttribute("data-editing", object);
  const bar = panel.getByTestId("shape-edit-bar");
  await expect(bar).toHaveAttribute("data-tool", "handles");
  await expect(bar.getByRole("button", { name: "Restore the AI original" })).toHaveCount(0);
  const outlines = page.getByTestId("review-object-outlines");

  const points = await handleBoxes(page);
  const first = points[0] ?? { x: 0, y: 0 };
  const centre = centreOf(points);
  const moved = edit(page, "PUT", object);
  await drag(page, first, { x: first.x + (first.x - centre.x) * 0.5, y: first.y + 30 });
  const move = (await moved).postDataJSON() as Body;
  expect(move.class_id).toBeNull();
  expect(move.geometry?.type).toBe("Polygon");
  await expect(outlines).toHaveAttribute("data-reviewed", object);
  await expect(page.getByTestId("ai-ghost")).toBeVisible();
  await expect(page.getByTestId("ai-layer")).toHaveAttribute("data-editing", object);
  await expect.poll(() => historyCount(page)).toBe(2);

  await bar.getByRole("button", { name: "Brush" }).click();
  await expect(bar).toHaveAttribute("data-tool", "brush");
  await expect(page.getByTestId("brush-map")).toBeVisible();
  const edge = { x: first.x + (first.x - centre.x) * 0.5, y: first.y + 30 };
  const far = { x: edge.x + (edge.x - centre.x) * 0.6, y: edge.y + (edge.y - centre.y) * 0.6 };
  const painted = edit(page, "PUT", object);
  await drag(page, centre, far);
  const paint = (await painted).postDataJSON() as Body;
  expect(paint.geometry?.type).toBe("Polygon");
  expect(areaOf(paint)).toBeGreaterThan(areaOf(move));
  await expect.poll(() => historyCount(page)).toBe(3);

  const erased = edit(page, "PUT", object);
  await page.keyboard.down("Shift");
  await drag(page, centre, far);
  await page.keyboard.up("Shift");
  const erase = (await erased).postDataJSON() as Body;
  expect(areaOf(erase)).toBeLessThan(areaOf(paint));
  await expect.poll(() => historyCount(page)).toBe(4);

  const cleared = edit(page, "DELETE", object);
  await bar.getByRole("button", { name: "Restore the AI original" }).click();
  await cleared;
  await expect(outlines).toHaveAttribute("data-reviewed", "");
  await expect(bar.getByRole("button", { name: "Restore the AI original" })).toHaveCount(0);

  await bar.getByRole("button", { name: "Done" }).click();
  await expect(panel.getByTestId("shape-edit-bar")).toHaveCount(0);
  await expect(page.getByTestId("ai-layer")).toHaveCount(0);
});

test("a double click opens the handles, Esc closes them, and a move keeps the changed type", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const panel = await openGuided(page);
  const object = (await panel.getAttribute("data-current")) ?? "";
  await blur(page);
  await page.keyboard.press("Enter");
  const centre = centreOf(await handleBoxes(page));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ai-layer")).toHaveCount(0);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(page.getByTestId("ai-layer")).toHaveAttribute("data-editing", object);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("ai-layer")).toHaveCount(0);

  await page
    .getByRole("group", { name: `Your answer on ${object}` })
    .getByRole("button", { name: /Disagree|Probably not/ })
    .first()
    .click();
  await panel.getByRole("button", { name: "Change the type" }).click();
  const typed = edit(page, "PUT", object);
  await panel
    .getByTestId("review-type-picker")
    .getByRole("button", { pressed: false })
    .first()
    .click();
  const type = (await typed).postDataJSON() as Body;
  expect(type.class_id).not.toBeNull();
  await panel.getByRole("button", { name: "Back to the answers" }).click();
  await blur(page);
  await page.keyboard.press("Enter");
  const first = (await handleBoxes(page))[0] ?? { x: 0, y: 0 };
  const moved = edit(page, "PUT", object);
  await drag(page, first, { x: first.x + 25, y: first.y + 25 });
  const move = (await moved).postDataJSON() as Body;
  expect(move.class_id).toBe(type.class_id);
  expect(move.geometry?.type).toBe("Polygon");
});

test("a read only reviewer gets no handles", async ({ page }) => {
  await openGuided(page, "&as=DH");
  await blur(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("shape-edit-bar")).toHaveCount(0);
  await expect(page.getByTestId("ai-layer")).toHaveCount(0);
});
