import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";

type Point = { x: number; y: number };
type Body = { geometry: { type: string; coordinates: number[][][] } | null };

test.use({ viewport: { width: 1440, height: 900 } });

async function openGuided(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&mode=guided`);
  const panel = page.getByTestId("stage-review-objects");
  await expect(panel).toHaveAttribute("data-ready", "true", { timeout: 25_000 });
  const start = page.getByRole("button", { name: "Got it, start" });
  if (await start.isVisible()) await start.click();
  return panel;
}

async function openEditor(page: Page, object: string) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("outline-editor")).toHaveAttribute("data-editing", object);
  return settledPoints(page);
}

async function pointsNow(page: Page): Promise<Point[]> {
  const found = page.getByTestId("outline-point");
  await expect(found.first()).toBeVisible();
  const points: Point[] = [];
  for (const handle of await found.all()) {
    const box = await handle.boundingBox();
    if (box !== null) points.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return points;
}

async function settledPoints(page: Page): Promise<Point[]> {
  let last = await pointsNow(page);
  for (let turn = 0; turn < 40; turn += 1) {
    await page.waitForTimeout(200);
    const next = await pointsNow(page);
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
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

const countPuts = (page: Page, object: string) => {
  const seen = { count: 0 };
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      decodeURIComponent(request.url()).endsWith(`/edits/${object}`)
    )
      seen.count += 1;
  });
  return seen;
};

const saved = (page: Page, object: string) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      decodeURIComponent(response.url()).endsWith(`/edits/${object}`),
  );

const at = (points: readonly Point[], index: number): Point => points[index] ?? { x: 0, y: 0 };

test("a crossing draft sends nothing, Done sends one outline with an added and a removed point", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const panel = await openGuided(page);
  const object = (await panel.getAttribute("data-current")) ?? "";
  const puts = countPuts(page, object);
  const points = await openEditor(page, object);
  expect(points).toHaveLength(4);
  const editor = page.getByTestId("outline-editor");
  const bar = panel.getByTestId("shape-edit-bar");
  const done = bar.getByRole("button", { name: "Done" });
  const [p0, p1, p2] = [at(points, 0), at(points, 1), at(points, 2)];

  const across = { x: Math.max(p1.x, p2.x) + 40, y: (p1.y + p2.y) / 2 };
  await drag(page, p0, across);
  await expect(editor).not.toHaveAttribute("data-crossing", "0");
  await expect(page.getByTestId("outline-crossing-edge").first()).toBeVisible();
  await expect(bar.getByTestId("outline-crossing")).toHaveText("Outline crosses itself");
  await expect(done).toBeDisabled();

  const back = { x: p0.x - 15, y: p0.y - 10 };
  await drag(page, across, back);
  await expect(editor).toHaveAttribute("data-crossing", "0");
  await expect(page.getByTestId("outline-crossing-edge")).toHaveCount(0);
  await expect(done).toBeEnabled();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).not.toHaveAttribute("data-crossing", "0");
  await expect(done).toBeDisabled();
  await page.keyboard.press("Shift+ControlOrMeta+z");
  await expect(editor).toHaveAttribute("data-crossing", "0");

  const middle = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  await page.mouse.move(middle.x, middle.y);
  await expect(page.getByTestId("outline-midpoint")).toBeVisible();
  await drag(page, middle, { x: middle.x + 30, y: middle.y });
  await expect(editor).toHaveAttribute("data-points", "5");
  await expect(page.getByTestId("outline-point").nth(2)).toHaveAttribute("data-selected", "true");
  await page.keyboard.press("Backspace");
  await expect(editor).toHaveAttribute("data-points", "4");
  await expect(editor).toHaveAttribute("data-editing", object);

  await drag(page, middle, { x: middle.x + 25, y: middle.y + 5 });
  await expect(editor).toHaveAttribute("data-points", "5");
  const p3 = at(await pointsNow(page), 4);
  const p3Middle = { x: (p3.x + back.x) / 2, y: (p3.y + back.y) / 2 };
  await drag(page, p3Middle, { x: p3Middle.x - 20, y: p3Middle.y });
  await expect(editor).toHaveAttribute("data-points", "6");
  const extra = page.getByTestId("outline-point").nth(5);
  const box = await extra.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.click(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  );
  await page.keyboard.up("Alt");
  await expect(editor).toHaveAttribute("data-points", "5");
  expect(puts.count).toBe(0);

  const response = saved(page, object);
  await done.click();
  const body = (await response).request().postDataJSON() as Body;
  expect(body.geometry?.coordinates[0]).toHaveLength(6);
  await expect(page.getByText(`New outline saved for ${object}.`, { exact: false })).toBeVisible();
  await expect(page.getByTestId("outline-editor")).toHaveCount(0);
  await expect(page.getByTestId("review-object-outlines")).toHaveAttribute("data-reviewed", object);
  await page.waitForTimeout(500);
  expect(puts.count).toBe(1);
});

test("stepping away from a crossing asks first, Esc discards, and a refused outline is reported", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const panel = await openGuided(page);
  const object = (await panel.getAttribute("data-current")) ?? "";
  const puts = countPuts(page, object);
  const points = await openEditor(page, object);
  const bar = panel.getByTestId("shape-edit-bar");
  const [p0, p1, p2] = [at(points, 0), at(points, 1), at(points, 2)];
  await drag(page, p0, { x: Math.max(p1.x, p2.x) + 40, y: (p1.y + p2.y) / 2 });
  await page.keyboard.press("j");
  await expect(bar.getByTestId("outline-leave")).toBeVisible();
  await expect(panel).toHaveAttribute("data-current", object);
  await bar.getByRole("button", { name: "Fix the outline" }).click();
  await expect(bar.getByTestId("outline-leave")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("outline-editor")).toHaveCount(0);
  expect(puts.count).toBe(0);

  await page.evaluate(() => sessionStorage.setItem("parfocal.fake.reject-outlines", "1"));
  const again = await openEditor(page, object);
  expect(again).toHaveLength(4);
  await drag(page, at(again, 0), { x: at(again, 0).x - 15, y: at(again, 0).y - 15 });
  const response = saved(page, object);
  await page.keyboard.press("Enter");
  expect((await response).status()).toBe(400);
  await expect(
    page.getByText(`The outline of ${object} was not saved.`, { exact: false }),
  ).toBeVisible();
  await expect(page.getByTestId("review-object-outlines")).toHaveAttribute("data-reviewed", "");
  expect(puts.count).toBe(1);
});

test("an outline of more than 32 points keeps every point that was not moved", async ({ page }) => {
  test.setTimeout(120_000);
  const panel = await openGuided(page);
  const object = (await panel.getAttribute("data-current")) ?? "";
  const ring = Array.from({ length: 40 }, (_, index) => {
    const angle = (index / 40) * Math.PI * 2;
    return [805 + Math.cos(angle) * 38.25, 538 + Math.sin(angle) * 37.75];
  });
  const status = await page.evaluate(
    async ({ url, coordinates }) => {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          class_id: null,
          deleted: false,
          geometry: { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] },
        }),
      });
      return response.status;
    },
    { url: `/api/review-tasks/${rt14}/slides/${a1}/edits/${object}`, coordinates: ring },
  );
  expect(status).toBe(200);
  await openGuided(page);
  await expect(panel).toHaveAttribute("data-current", object);
  const points = await openEditor(page, object);
  expect(points).toHaveLength(40);
  const moving = at(points, 5);
  await drag(page, moving, { x: moving.x + 20, y: moving.y + 20 });
  const response = saved(page, object);
  await panel.getByTestId("shape-edit-bar").getByRole("button", { name: "Done" }).click();
  const sent = ((await response).request().postDataJSON() as Body).geometry?.coordinates[0] ?? [];
  expect(sent).toHaveLength(41);
  const kept = ring.filter((point, index) => {
    const now = sent[index] ?? [];
    return now[0] === point[0] && now[1] === point[1];
  });
  expect(kept).toHaveLength(39);
  expect(sent[5]).not.toEqual(ring[5]);
});
