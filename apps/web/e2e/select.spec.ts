import { expect, type Page, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: Page) {
  await page.goto(`/projects/${p07}?tab=slides`);
  await page
    .getByTestId("slide-row")
    .filter({ hasText: "tumor_044" })
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 15_000,
  });
  return page.getByTestId("slide-stage");
}

async function drawRuler(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("l");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function settled(page: Page) {
  const host = page.getByTestId("slide-host");
  let last = await host.getAttribute("data-camera");
  await expect
    .poll(async () => {
      await page.waitForTimeout(120);
      const now = await host.getAttribute("data-camera");
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

const lineOf = (page: Page) => page.getByTestId("ruler-layer").locator("line").first();

test("V arms the select tool, a click picks the ruler and an empty click drops it", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.mouse.click(box.x + 300, box.y + 200);
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "1");
  await expect(page.getByTestId("select-handle")).toHaveCount(2);
  await page.mouse.click(box.x + 300, box.y + 400);
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "");
});

test("a marquee selects the ruler it touches", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 260, { steps: 6 });
  await expect(page.getByTestId("select-marquee")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "1");
});

test("dragging a selected ruler moves it and Shift locks the move to one axis", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  const xBefore = Number(await lineOf(page).getAttribute("x1"));
  const yBefore = Number(await lineOf(page).getAttribute("y1"));
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 235, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const xAfter = Number(await lineOf(page).getAttribute("x1"));
  const yAfter = Number(await lineOf(page).getAttribute("y1"));
  expect(Math.abs(yAfter - yBefore)).toBeLessThan(1);
  expect(xAfter - xBefore).toBeGreaterThan(55);
  expect(xAfter - xBefore).toBeLessThan(65);
});

test("a move survives the browser dropping pointer capture in the middle of the drag", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  const xBefore = Number(await lineOf(page).getAttribute("x1"));
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 330, box.y + 200, { steps: 3 });
  await page.getByTestId("slide-host").evaluate((host) => {
    host.dispatchEvent(new PointerEvent("lostpointercapture", { pointerId: 1, bubbles: true }));
  });
  await page.mouse.move(box.x + 360, box.y + 200, { steps: 3 });
  await page.mouse.up();
  const xAfter = Number(await lineOf(page).getAttribute("x1"));
  expect(xAfter - xBefore).toBeGreaterThan(55);
  expect(xAfter - xBefore).toBeLessThan(65);
});

test("dragging an end handle of the selected ruler reshapes it", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  await page.mouse.click(box.x + 300, box.y + 200);
  const endBefore = Number(await lineOf(page).getAttribute("x2"));
  await page.mouse.move(box.x + 400, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 460, box.y + 260, { steps: 6 });
  await page.mouse.up();
  const endAfter = Number(await lineOf(page).getAttribute("x2"));
  expect(endAfter - endBefore).toBeGreaterThan(40);
});

test("Escape in the middle of a move puts the ruler back", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 800, height: 600 };
  await drawRuler(page, box);
  await page.keyboard.press("v");
  const before = Number(await lineOf(page).getAttribute("x1"));
  await page.mouse.move(box.x + 300, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 260, { steps: 6 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(Number(await lineOf(page).getAttribute("x1"))).toBeCloseTo(before, 1);
  await expect(stage).toHaveAttribute("data-tool", "select");
});

async function drawRectangle(page: Page, box: { x: number; y: number }) {
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 300, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await page.keyboard.press("v");
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-tool", "select");
}

async function handlePositions(page: Page) {
  return page.getByTestId("select-handle").evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: Number(node.getAttribute("cx")),
      y: Number(node.getAttribute("cy")),
    })),
  );
}

const outlineOf = (page: Page) => page.getByTestId("select-outline").locator("path").first();

test("a corner grabbed off centre keeps its grab offset instead of jumping to the pointer", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.mouse.click(box.x + 300, box.y + 250);
  await expect(page.getByTestId("select-handle")).toHaveCount(4);
  await page.mouse.move(box.x + 406, box.y + 305);
  await page.mouse.down();
  await page.mouse.move(box.x + 430, box.y + 330, { steps: 3 });
  const during = await handlePositions(page);
  expect(Math.abs((during[2]?.x ?? 0) - 424)).toBeLessThan(0.5);
  expect(Math.abs((during[2]?.y ?? 0) - 325)).toBeLessThan(0.5);
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const after = await handlePositions(page);
  expect(Math.abs((after[2]?.x ?? 0) - 424)).toBeLessThan(0.5);
  expect(Math.abs((after[2]?.y ?? 0) - 325)).toBeLessThan(0.5);
});

test("after a wheel zoom a move still follows the pointer", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.mouse.move(box.x + 300, box.y + 250);
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");
  await page.mouse.wheel(0, -300);
  await expect
    .poll(() => page.getByTestId("slide-host").getAttribute("data-camera"))
    .not.toBe(camera);
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + 300, box.y + 250);
  await expect(page.getByTestId("select-outline")).toHaveCount(1);
  const before = (await outlineOf(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 290, { steps: 4 });
  await page.mouse.up();
  const after = (await outlineOf(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(after.x - before.x - 60)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y - 40)).toBeLessThan(1);
  expect(Math.abs(after.width - before.width)).toBeLessThan(1);
});

test("a keyboard pan in the middle of a move keeps the grabbed point under the pointer", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.mouse.click(box.x + 300, box.y + 250);
  await expect(page.getByTestId("select-outline")).toHaveCount(1);
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 260, { steps: 2 });
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  await settled(page);
  await page.mouse.move(box.x + 321, box.y + 260);
  await page.mouse.up();
  await expect(stage).toHaveAttribute("data-save-state", "saved");
  const bounds = (await outlineOf(page).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(bounds.x + 1 + 100 - (box.x + 321))).toBeLessThan(1.5);
  expect(Math.abs(bounds.y + 1 + 50 - (box.y + 260))).toBeLessThan(1.5);
});

const layer = (page: Page) => page.getByTestId("select-layer");

test("double-click enters point editing, selected points move together and Esc leaves", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.mouse.dblclick(box.x + 300, box.y + 250);
  await expect(layer(page)).toHaveAttribute("data-editing", "1");
  await page.mouse.click(box.x + 400, box.y + 300);
  await expect(layer(page)).toHaveAttribute("data-vertices", "2");
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + 200, box.y + 300);
  await page.keyboard.up("Shift");
  await expect(layer(page)).toHaveAttribute("data-vertices", "2,3");
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 340, { steps: 3 });
  await page.mouse.up();
  const handles = await handlePositions(page);
  expect(Math.abs((handles[2]?.x ?? 0) - 420)).toBeLessThan(0.5);
  expect(Math.abs((handles[2]?.y ?? 0) - 340)).toBeLessThan(0.5);
  expect(Math.abs((handles[3]?.x ?? 0) - 220)).toBeLessThan(0.5);
  expect(Math.abs((handles[3]?.y ?? 0) - 340)).toBeLessThan(0.5);
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "4");
  await page.keyboard.press("Escape");
  await expect(layer(page)).toHaveAttribute("data-editing", "");
  await expect(layer(page)).toHaveAttribute("data-selected", "1");
  await page.keyboard.press("Escape");
  await expect(layer(page)).toHaveAttribute("data-selected", "");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

test("hovering an edge in edit mode offers a midpoint that drags in a new point", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.keyboard.press("Enter");
  await expect(layer(page)).toHaveAttribute("data-editing", "1");
  await page.mouse.move(box.x + 300, box.y + 201);
  await expect(layer(page)).toHaveAttribute("data-hover", "midpoint");
  await expect(page.getByTestId("select-midpoint")).toHaveCount(1);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 150, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "5");
  await expect(layer(page)).toHaveAttribute("data-vertices", "1");
  const handles = await handlePositions(page);
  expect(Math.abs((handles[1]?.x ?? 0) - 300)).toBeLessThan(0.5);
  expect(Math.abs((handles[1]?.y ?? 0) - 149)).toBeLessThan(0.5);
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("polygon-shape")).toHaveAttribute("data-points", "4");
});

test("select all, arrow nudges and Backspace act on every selected shape and undo brings them back", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 500, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 600, box.y + 300, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
  await page.keyboard.press("v");
  await page.keyboard.press("Meta+a");
  await expect(layer(page)).toHaveAttribute("data-selected", "1,2");
  await expect(page.getByTestId("select-group")).toHaveCount(1);
  const before = (await outlineOf(page).boundingBox()) ?? { x: 0, y: 0 };
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect
    .poll(async () => ((await outlineOf(page).boundingBox())?.x ?? 0) - before.x)
    .toBeCloseTo(1, 0);
  const after = (await outlineOf(page).boundingBox()) ?? { x: 0, y: 0 };
  expect(Math.abs(after.y - before.y - 10)).toBeLessThan(0.5);
  expect(await page.getByTestId("slide-host").getAttribute("data-camera")).toBe(camera);
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
  await expect(layer(page)).toHaveAttribute("data-selected", "");
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Meta+z");
  const restored = (await page.getByTestId("polygon-shape").first().boundingBox()) ?? {
    x: 0,
    y: 0,
  };
  expect(Math.abs(restored.x - (box.x + 199))).toBeLessThan(1);
});

test("Alt drag duplicates the selection and hovering shows the shape a click would pick", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await drawRectangle(page, box);
  await page.mouse.move(box.x + 300, box.y + 250);
  await expect(layer(page)).toHaveAttribute("data-hover", "shape");
  await expect(page.getByTestId("select-hover")).toHaveCount(1);
  await page.mouse.move(box.x + 700, box.y + 500);
  await expect(layer(page)).toHaveAttribute("data-hover", "");
  await page.mouse.click(box.x + 300, box.y + 250);
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 300, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 400, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.getByTestId("polygon-shape")).toHaveCount(2);
  await expect(layer(page)).toHaveAttribute("data-selected", "2");
  const copy = (await page.getByTestId("polygon-shape").nth(1).boundingBox()) ?? { x: 0, y: 0 };
  expect(Math.abs(copy.x - (box.x + 249))).toBeLessThan(1);
  expect(Math.abs(copy.y - (box.y + 349))).toBeLessThan(1);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});

test("double-click on a text label with the select tool edits it in place", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("t");
  await page.mouse.click(box.x + 300, box.y + 300);
  await page.keyboard.type("note");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("text-shape")).toHaveText("note");
  await page.keyboard.press("v");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.mouse.dblclick(box.x + 304, box.y + 300);
  const input = page.getByTestId("text-draft");
  await expect(input).toHaveValue("note");
  await page.keyboard.press("End");
  await page.keyboard.type(" more");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("text-shape")).toHaveText("note more");
  await expect(stage).toHaveAttribute("data-tool", "select");
  await page.keyboard.press("Meta+z");
  await expect(page.getByTestId("text-shape")).toHaveText("note");
});
