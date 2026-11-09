import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";

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
  return stage;
}

const corners = [
  [200, 150],
  [420, 170],
  [380, 360],
  [220, 330],
] as const;

async function drawSquare(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("p");
  for (const [x, y] of corners) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + corners[0][0] + 2, box.y + corners[0][1] + 1);
}

test("P draws a polygon that is saved and still there after a reload", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawSquare(page, box);
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-points", "4");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const drawn = await shape.getAttribute("data-vertices");

  await page.reload();
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-annotations", "loaded");
  await expect(shape).toHaveCount(1);
  await expect(shape).toHaveAttribute("data-points", "4");
  expect(await shape.getAttribute("data-vertices")).toBe(drawn);
});

test("Escape drops an unfinished polygon and a second Escape leaves the tool", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.getByRole("button", { name: "Polygon" }).click();
  await expect(stage).toHaveAttribute("data-tool", "polygon");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 300, box.y + 150);
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("polygon-vertex")).toHaveCount(0);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

test("a double-click closes the polygon on its last vertex", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 400, box.y + 160);
  await page.mouse.dblclick(box.x + 300, box.y + 320);
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "3");
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});

async function vertexPositions(page: Page) {
  return page.getByTestId("polygon-vertex").evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: Number(node.getAttribute("cx")),
      y: Number(node.getAttribute("cy")),
    })),
  );
}

async function rubberEnd(page: Page) {
  const d = (await page.getByTestId("polygon-rubber").getAttribute("d")) ?? "";
  const last = d.trim().split(" L").at(-1) ?? "";
  const [x, y] = last.replace(/^M/, "").split(" ").map(Number);
  return { x: x ?? Number.NaN, y: y ?? Number.NaN };
}

async function cameraOf(page: Page) {
  return (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "";
}

async function settled(page: Page) {
  let last = await cameraOf(page);
  await expect
    .poll(async () => {
      await page.waitForTimeout(120);
      const now = await cameraOf(page);
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

test("a keyboard pan during a draft keeps the rubber band end under the cursor", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 420, box.y + 170);
  await page.mouse.move(box.x + 300, box.y + 300);
  const before = await vertexPositions(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  await expect
    .poll(() => vertexPositions(page).then((v) => v[0]?.x ?? 0))
    .toBeLessThan((before[0]?.x ?? 0) - 20);
  const end = await rubberEnd(page);
  expect(Math.abs(end.x - 300)).toBeLessThan(0.5);
  expect(Math.abs(end.y - 300)).toBeLessThan(0.5);
  await settled(page);
  await page.mouse.click(box.x + 300, box.y + 300);
  const after = await vertexPositions(page);
  expect(Math.abs((after[2]?.x ?? 0) - 300)).toBeLessThan(0.5);
  expect(Math.abs((after[2]?.y ?? 0) - 300)).toBeLessThan(0.5);
});

test("resizing the window in the middle of a draft keeps the vertices on their slide points", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 420, box.y + 170);
  const camera = await cameraOf(page);
  const before = await vertexPositions(page);
  await page.setViewportSize({ width: 1000, height: 720 });
  const shrunk = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const shift = (shrunk.width - box.width) / 2;
  expect(shift).toBeLessThan(-100);
  await expect.poll(() => cameraOf(page)).toBe(camera);
  await expect
    .poll(() =>
      vertexPositions(page).then((v) => Math.abs((v[0]?.x ?? 0) - ((before[0]?.x ?? 0) + shift))),
    )
    .toBeLessThan(0.5);
  const after = await vertexPositions(page);
  expect(Math.abs((after[1]?.x ?? 0) - ((before[1]?.x ?? 0) + shift))).toBeLessThan(0.5);
  expect(Math.abs((after[1]?.y ?? 0) - (before[1]?.y ?? 0))).toBeLessThan(0.5);
});

test("a double-click on the first vertex closes the polygon and leaves no stray draft", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners.slice(0, 3)) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.dblclick(box.x + corners[0][0] + 1, box.y + corners[0][1] + 1);
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await expect(page.getByTestId("polygon-layer")).toHaveAttribute("data-drafting", "0");
  await page.waitForTimeout(600);
  await page.mouse.click(box.x + corners[0][0] + 1, box.y + corners[0][1] + 1);
  await expect(page.getByTestId("polygon-layer")).toHaveAttribute("data-drafting", "1");
});

test("the rubber band hides while the pointer is off the stage and returns with it", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.move(box.x + 300, box.y + 300);
  await expect(page.getByTestId("polygon-rubber")).toHaveCount(1);
  await page.mouse.move(box.x + 300, box.y - 20);
  await expect(page.getByTestId("polygon-rubber")).toHaveCount(0);
  await page.mouse.move(box.x + 320, box.y + 310);
  await expect(page.getByTestId("polygon-rubber")).toHaveCount(1);
  const end = await rubberEnd(page);
  expect(Math.abs(end.x - 320)).toBeLessThan(0.5);
  expect(Math.abs(end.y - 310)).toBeLessThan(0.5);
});

test("a wheel zoom in the middle of a draft keeps the next click under the pointer", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  await page.mouse.click(box.x + 200, box.y + 150);
  await page.mouse.click(box.x + 420, box.y + 170);
  const camera = await cameraOf(page);
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => cameraOf(page)).not.toBe(camera);
  await page.waitForTimeout(500);
  const end = await rubberEnd(page);
  expect(Math.abs(end.x - 300)).toBeLessThan(0.5);
  await page.mouse.click(box.x + 380, box.y + 360);
  const after = await vertexPositions(page);
  expect(after).toHaveLength(3);
  expect(Math.abs((after[2]?.x ?? 0) - 380)).toBeLessThan(0.5);
  expect(Math.abs((after[2]?.y ?? 0) - 360)).toBeLessThan(0.5);
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 380, box.y + 200);
  const snapped = await rubberEnd(page);
  await page.keyboard.up("Shift");
  expect(Math.abs(snapped.x - 380)).toBeLessThan(0.5);
  expect(Math.abs(snapped.y - 200)).toBeLessThan(0.5);
});

test("Backspace removes the last vertex of a draft and Space held pans in the middle of it", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("p");
  for (const [x, y] of corners.slice(0, 3)) await page.mouse.click(box.x + x, box.y + y);
  await expect(page.getByTestId("polygon-layer")).toHaveAttribute("data-drafting", "3");
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("polygon-layer")).toHaveAttribute("data-drafting", "2");
  const before = await vertexPositions(page);
  const camera = await cameraOf(page);
  await page.mouse.move(box.x + 500, box.y + 400);
  await page.keyboard.down("Space");
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 380, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect.poll(() => cameraOf(page)).not.toBe(camera);
  await expect(page.getByTestId("polygon-layer")).toHaveAttribute("data-drafting", "2");
  await expect
    .poll(() => vertexPositions(page).then((v) => (v[0]?.x ?? 0) - (before[0]?.x ?? 0)))
    .toBeLessThan(-60);
  await page.mouse.click(box.x + 380, box.y + 360);
  const after = await vertexPositions(page);
  expect(after).toHaveLength(3);
  expect(Math.abs((after[2]?.x ?? 0) - 380)).toBeLessThan(0.5);
});
