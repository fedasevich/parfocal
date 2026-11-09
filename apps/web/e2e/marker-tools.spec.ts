import { expect, type Locator, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

const fakeMicronsPerPixel = 0.5;

type Box = { x: number; y: number; width: number; height: number };

type Camera = { x: number; y: number; zoom: number };

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
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  return { stage, box };
}

const cameraOf = async (page: Page): Promise<Camera> => {
  const raw = (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "0,0,0";
  const [x = 0, y = 0, zoom = 0] = raw.split(",").map(Number);
  return { x, y, zoom };
};

async function settledCamera(page: Page): Promise<Camera> {
  const host = page.getByTestId("slide-host");
  for (let round = 0; round < 50; round++) {
    const before = await host.getAttribute("data-camera");
    await page.waitForTimeout(80);
    if (before === (await host.getAttribute("data-camera"))) break;
  }
  return cameraOf(page);
}

const onScreen = (camera: Camera, box: Box, point: { x: number; y: number }) => ({
  x: box.width / 2 + (point.x - camera.x) * 2 ** camera.zoom,
  y: box.height / 2 + (point.y - camera.y) * 2 ** camera.zoom,
});

const onSlide = (camera: Camera, box: Box, x: number, y: number) => ({
  x: camera.x + (x - box.width / 2) / 2 ** camera.zoom,
  y: camera.y + (y - box.height / 2) / 2 ** camera.zoom,
});

async function zoomIn(page: Page, box: Box, times: number) {
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, -300);
    await settledCamera(page);
  }
  return settledCamera(page);
}

const markerAt = async (marker: Locator) => ({
  x: Number(await marker.getAttribute("cx")),
  y: Number(await marker.getAttribute("cy")),
});

const styleAt = async (node: Locator) => {
  const style = (await node.getAttribute("style")) ?? "";
  const left = /left:\s*([-\d.]+)px/.exec(style)?.[1];
  const top = /top:\s*([-\d.]+)px/.exec(style)?.[1];
  return { x: Number(left), y: Number(top) };
};

const lineEnds = async (line: Locator) => ({
  x1: Number(await line.getAttribute("x1")),
  y1: Number(await line.getAttribute("y1")),
  x2: Number(await line.getAttribute("x2")),
  y2: Number(await line.getAttribute("y2")),
});

const expectNear = (actual: { x: number; y: number }, expected: { x: number; y: number }) => {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(0.5);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(0.5);
};

const micronLabel = (slideLength: number) => {
  const microns = slideLength * fakeMicronsPerPixel;
  const tenths = Math.round(microns * 10) / 10;
  if (tenths < 100) return `${tenths.toFixed(1)} µm`;
  if (microns < 999.5) return `${Math.round(microns)} µm`;
  return `${(microns / 1000).toFixed(2)} mm`;
};

test("a marker lands under the pointer at four zoom levels and follows a pan", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("m");
  const markers = page.getByTestId("count-marker");
  const dropped: { x: number; y: number }[] = [];
  for (const [index, zooms] of [0, 1, 1, 2].entries()) {
    const camera = await zoomIn(page, box, zooms);
    const at = { x: 260 + index * 70, y: 240 + index * 40 };
    await page.mouse.click(box.x + at.x, box.y + at.y);
    await expect(markers).toHaveCount(index + 1);
    expectNear(await markerAt(markers.nth(index)), at);
    dropped.push(onSlide(camera, box, at.x, at.y));
  }
  await page.keyboard.press("Escape");
  await page.keyboard.press("h");
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 330, { steps: 8 });
  await page.mouse.up();
  const panned = await settledCamera(page);
  for (const [index, point] of dropped.entries()) {
    expectNear(await markerAt(markers.nth(index)), onScreen(panned, box, point));
  }
});

test("a wobbling click drops a marker where the pointer was released and leaves the view still", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("m");
  const before = await zoomIn(page, box, 2);
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 302, box.y + 301);
  await page.mouse.move(box.x + 301, box.y + 302);
  await page.mouse.up();
  const markers = page.getByTestId("count-marker");
  await expect(markers).toHaveCount(1);
  expectNear(await markerAt(markers.first()), { x: 301, y: 302 });
  await page.waitForTimeout(150);
  expect(await cameraOf(page)).toEqual(before);
});

test("a drag in the marker tool pans the slide and drops nothing", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("m");
  const before = await zoomIn(page, box, 1);
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 480, box.y + 340, { steps: 5 });
  await page.mouse.up();
  const after = await settledCamera(page);
  await expect(page.getByTestId("count-marker")).toHaveCount(0);
  expect(after.x).toBeLessThan(before.x - 60 / 2 ** before.zoom);
  expect(after.y).toBeLessThan(before.y - 30 / 2 ** before.zoom);
  expect(after.zoom).toBe(before.zoom);
});

test("a double click in the marker, arrow, text and comment tools never zooms the view", async ({
  page,
}) => {
  const { box, stage } = await openSlide(page);
  const start = await settledCamera(page);
  for (const [key, tool] of [
    ["m", "marker"],
    ["Shift+L", "arrow"],
    ["t", "text"],
    ["c", "comment"],
  ] as const) {
    await page.keyboard.press(key);
    await expect(stage).toHaveAttribute("data-tool", tool);
    await page.mouse.dblclick(box.x + 320, box.y + 280);
    expect(await settledCamera(page)).toEqual(start);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(stage).toHaveAttribute("data-tool", "select");
  }
  await expect(page.getByTestId("count-marker")).toHaveCount(2);
});

test("markers, arrows, text and pins stay on their slide points when the window resizes", async ({
  page,
}) => {
  const { box, stage } = await openSlide(page);
  await page.keyboard.press("m");
  const camera = await zoomIn(page, box, 1);
  await page.mouse.click(box.x + 300, box.y + 300);
  const marker = onSlide(camera, box, 300, 300);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+L");
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 360, { steps: 3 });
  await page.mouse.up();
  const arrowEnd = onSlide(camera, box, 500, 360);
  await page.keyboard.press("Escape");
  await page.keyboard.press("t");
  await page.mouse.click(box.x + 350, box.y + 420);
  await page.keyboard.type("edge");
  await page.keyboard.press("Enter");
  const text = onSlide(camera, box, 350, 420);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await page.mouse.click(box.x + 600, box.y + 200);
  const pin = onSlide(camera, box, 600, 200);
  await expect(page.getByTestId("pin-draft")).toHaveCount(1);

  await page.setViewportSize({ width: 980, height: 640 });
  const resized = (await stage.boundingBox()) ?? box;
  expect(resized.width).not.toBe(box.width);
  await page.waitForTimeout(200);
  const after = await settledCamera(page);

  expectNear(
    await markerAt(page.getByTestId("count-marker").first()),
    onScreen(after, resized, marker),
  );
  const arrow =
    (await page.getByTestId("arrow-shape").locator("path").first().getAttribute("d")) ?? "";
  const [, endX = "0", endY = "0"] = /L([-\d.]+) ([-\d.]+) M/.exec(arrow) ?? [];
  expectNear({ x: Number(endX), y: Number(endY) }, onScreen(after, resized, arrowEnd));
  expectNear(await styleAt(page.getByTestId("text-shape").first()), onScreen(after, resized, text));
  expectNear(await styleAt(page.getByTestId("pin-draft")), onScreen(after, resized, pin));
});

test("Shift-click deletes only the nearest marker at high zoom and the class counts follow", async ({
  page,
}) => {
  const { box, stage } = await openSlide(page);
  await page.keyboard.press("m");
  await zoomIn(page, box, 3);
  const rows = page.getByTestId("count-row");
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.mouse.click(box.x + 312, box.y + 300);
  await page.keyboard.press("2");
  await page.mouse.click(box.x + 324, box.y + 300);
  const markers = page.getByTestId("count-marker");
  await expect(markers).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-count", "2");
  await expect(rows.nth(1)).toHaveAttribute("data-count", "1");

  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 314, box.y + 302);
  await page.keyboard.up("Shift");
  await expect(markers).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-count", "1");
  await expect(rows.nth(1)).toHaveAttribute("data-count", "1");
  expectNear(await markerAt(markers.nth(0)), { x: 300, y: 300 });
  expectNear(await markerAt(markers.nth(1)), { x: 324, y: 300 });

  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 300, box.y + 330);
  await page.keyboard.up("Shift");
  await expect(markers).toHaveCount(2);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.keyboard.press("Control+z");
  await expect(markers).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-count", "2");
  await page.keyboard.press("Control+Shift+z");
  await expect(markers).toHaveCount(2);
});

test("a ruler reads its length in microns at two zooms, undoes and redoes", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("l");
  const lines = page.getByTestId("ruler-layer").locator("line");
  const labels = page.getByTestId("ruler-layer").locator("text");
  for (const [index, zooms] of [0, 2].entries()) {
    const camera = await zoomIn(page, box, zooms);
    await page.mouse.move(box.x + 200, box.y + 300 + index * 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 520, box.y + 340 + index * 60, { steps: 1 });
    await page.mouse.up();
    await expect(lines).toHaveCount(index + 1);
    const ends = await lineEnds(lines.nth(index));
    expectNear({ x: ends.x1, y: ends.y1 }, { x: 200, y: 300 + index * 60 });
    expectNear({ x: ends.x2, y: ends.y2 }, { x: 520, y: 340 + index * 60 });
    const slideLength = Math.hypot(320, 40) / 2 ** camera.zoom;
    await expect(labels.nth(index)).toHaveText(micronLabel(slideLength));
  }
  await page.keyboard.press("Control+z");
  await expect(lines).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(lines).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(lines).toHaveCount(1);
});

test("Shift snaps a ruler mid drag and letting Shift go frees the end again", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("l");
  await zoomIn(page, box, 1);
  const draft = page.getByTestId("ruler-layer").locator("line").first();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 230, { steps: 2 });
  let ends = await lineEnds(draft);
  expectNear({ x: ends.x2, y: ends.y2 }, { x: 420, y: 230 });
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 421, box.y + 231);
  ends = await lineEnds(draft);
  expect(Math.abs(ends.y2 - ends.y1)).toBeLessThan(0.01);
  expect(Math.hypot(ends.x2 - ends.x1, ends.y2 - ends.y1)).toBeCloseTo(Math.hypot(221, 31), 1);
  await page.keyboard.up("Shift");
  await page.mouse.move(box.x + 422, box.y + 232);
  ends = await lineEnds(draft);
  expectNear({ x: ends.x2, y: ends.y2 }, { x: 422, y: 232 });
  await page.mouse.up();
});

test("an arrow drawn with one fast move ends under the pointer and Shift snaps it to 45 degrees", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("Shift+L");
  const camera = await zoomIn(page, box, 2);
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 500, { steps: 1 });
  await page.mouse.up();
  const paths = page.getByTestId("arrow-shape").locator("path");
  await expect(paths).toHaveCount(2);
  const first = (await paths.first().getAttribute("d")) ?? "";
  const [, fromX = "0", fromY = "0", toX = "0", toY = "0"] =
    /M([-\d.]+) ([-\d.]+) L([-\d.]+) ([-\d.]+) M/.exec(first) ?? [];
  expectNear({ x: Number(fromX), y: Number(fromY) }, { x: 150, y: 150 });
  expectNear({ x: Number(toX), y: Number(toY) }, { x: 700, y: 500 });

  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 200, box.y + 400);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 230, { steps: 2 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(2);
  const second = (await paths.nth(2).getAttribute("d")) ?? "";
  const [, , , snapX = "0", snapY = "0"] =
    /M([-\d.]+) ([-\d.]+) L([-\d.]+) ([-\d.]+) M/.exec(second) ?? [];
  expect(Math.abs(Number(snapX) - 200 - (400 - Number(snapY)))).toBeLessThan(0.01);
  expect(camera.zoom).toBeGreaterThan(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("arrow-shape")).toHaveCount(2);
});

test("text placed while zoomed in keeps its point after a zoom out, Enter keeps and Escape drops", async ({
  page,
}) => {
  const { box, stage } = await openSlide(page);
  await page.keyboard.press("t");
  const camera = await zoomIn(page, box, 2);
  await page.mouse.click(box.x + 330, box.y + 260);
  const draft = page.getByTestId("text-draft");
  await expect(draft).toBeFocused();
  expectNear(await styleAt(draft), { x: 330, y: 260 });
  const point = onSlide(camera, box, 330, 260);
  await page.keyboard.type("necrosis");
  await page.keyboard.press("Enter");
  const shapes = page.getByTestId("text-shape");
  await expect(shapes).toHaveCount(1);
  await expect(draft).toHaveCount(0);

  await page.mouse.click(box.x + 500, box.y + 400);
  await page.keyboard.type("dropped");
  await page.keyboard.press("Escape");
  await expect(draft).toHaveCount(0);
  await expect(shapes).toHaveCount(1);
  await expect(stage).toHaveAttribute("data-tool", "text");

  await page.mouse.move(box.x + 700, box.y + 600);
  await page.mouse.wheel(0, 300);
  const out = await settledCamera(page);
  expect(out.zoom).toBeLessThan(camera.zoom);
  expectNear(await styleAt(shapes.first()), onScreen(out, box, point));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(shapes).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(shapes).toHaveCount(1);
});

test("a comment pin lands under the pointer when zoomed in and stays put through a zoom out", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("c");
  const camera = await zoomIn(page, box, 2);
  await page.mouse.click(box.x + 420, box.y + 310);
  const draft = page.getByTestId("pin-draft");
  expectNear(await styleAt(draft), { x: 420, y: 310 });
  const point = onSlide(camera, box, 420, 310);
  await page.mouse.move(box.x + 700, box.y + 600);
  await page.mouse.wheel(0, 300);
  const out = await settledCamera(page);
  expect(out.zoom).toBeLessThan(camera.zoom);
  expectNear(await styleAt(draft), onScreen(out, box, point));
});

test("pressing Shift without moving snaps the ruler and its readout live, and releasing frees it", async ({
  page,
}) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("l");
  await zoomIn(page, box, 1);
  const line = page.getByTestId("ruler-layer").locator("line").first();
  const label = page.getByTestId("ruler-layer").locator("text").first();
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 240, { steps: 2 });
  const free = await label.textContent();
  await page.keyboard.down("Shift");
  await expect
    .poll(async () => {
      const ends = await lineEnds(line);
      return Math.abs(ends.y2 - ends.y1);
    })
    .toBeLessThan(0.01);
  expect(await label.textContent()).toBe(free);
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await lineEnds(line)).y2).toBeCloseTo(240, 0);
  await page.mouse.up();
});

test("pressing Shift without moving snaps the arrow draft live", async ({ page }) => {
  const { box } = await openSlide(page);
  await page.keyboard.press("Shift+L");
  await settledCamera(page);
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 240, { steps: 2 });
  const draft = page.getByTestId("arrow-draft").locator("path").first();
  const endY = async () =>
    Number(/L([-\d.]+) ([-\d.]+) M/.exec((await draft.getAttribute("d")) ?? "")?.[2]);
  expect(await endY()).toBeCloseTo(240, 0);
  await page.keyboard.down("Shift");
  await expect.poll(endY).toBeCloseTo(200, 1);
  await page.keyboard.up("Shift");
  await expect.poll(endY).toBeCloseTo(240, 0);
  await page.mouse.up();
  await expect(page.getByTestId("arrow-shape")).toHaveCount(1);
});

test("switching tools or leaving the field keeps typed text instead of losing it", async ({
  page,
}) => {
  const { box, stage } = await openSlide(page);
  await page.keyboard.press("t");
  await settledCamera(page);
  const draft = page.getByTestId("text-draft");
  const shapes = page.getByTestId("text-shape");
  await page.mouse.click(box.x + 300, box.y + 200);
  await page.keyboard.type("stroma");
  await draft.evaluate((node) => (node as HTMLInputElement).blur());
  await expect(shapes).toHaveCount(1);
  await expect(draft).toHaveCount(0);

  await page.mouse.click(box.x + 400, box.y + 300);
  await page.keyboard.type("vessel");
  await page.getByRole("button", { name: "Count marker" }).click();
  await expect(stage).toHaveAttribute("data-tool", "marker");
  await expect(shapes).toHaveCount(2);

  await page.keyboard.press("t");
  await page.mouse.click(box.x + 500, box.y + 400);
  await draft.evaluate((node) => (node as HTMLInputElement).blur());
  await expect(draft).toHaveCount(0);
  await expect(shapes).toHaveCount(2);
});
