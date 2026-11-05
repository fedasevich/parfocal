import { expect, test } from "@playwright/test";

const p07 = "00000000-0000-4000-8003-000000000007";

async function openSlide(page: import("@playwright/test").Page) {
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

test("R drags a rectangle and Shift makes it a square", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await expect(stage).toHaveAttribute("data-tool", "rectangle");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 260, { steps: 5 });
  await page.mouse.up();
  const shapes = page.getByTestId("polygon-shape");
  await expect(shapes).toHaveCount(1);
  expect(Number(await shapes.nth(0).getAttribute("data-points"))).toBe(4);
  await expect(stage).toHaveAttribute("data-save-state", "saved");

  await page.mouse.move(box.x + 500, box.y + 200);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 700, box.y + 260, { steps: 5 });
  const preview = page.getByTestId("drag-preview").first();
  await expect(page.getByTestId("drag-layer").first()).toHaveAttribute("data-equal-sides", "true");
  const size = await preview.boundingBox();
  expect(Math.abs((size?.width ?? 0) - (size?.height ?? 1))).toBeLessThan(3);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(shapes).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(stage).toHaveAttribute("data-tool", "select");
});

test("O drags an ellipse and Shift makes it a circle", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("o");
  await expect(stage).toHaveAttribute("data-tool", "ellipse");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + 420, box.y + 280, { steps: 5 });
  await expect(page.getByTestId("drag-layer").nth(1)).toHaveAttribute("data-equal-sides", "true");
  const size = await page.getByTestId("drag-preview").boundingBox();
  expect(Math.abs((size?.width ?? 0) - (size?.height ?? 1))).toBeLessThan(3);
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const shapes = page.getByTestId("polygon-shape");
  await expect(shapes).toHaveCount(1);
  expect(Number(await shapes.nth(0).getAttribute("data-points"))).toBe(64);
  await expect(stage).toHaveAttribute("data-save-state", "saved");
});

function pathPoints(d: string | null) {
  return (d ?? "")
    .replace("Z", "")
    .trim()
    .split(/[ML]/)
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.split(" ").map(Number))
    .map(([x, y]) => ({ x: x ?? Number.NaN, y: y ?? Number.NaN }));
}

async function cameraOf(page: import("@playwright/test").Page) {
  return (await page.getByTestId("slide-host").getAttribute("data-camera")) ?? "";
}

test("a cancelled pointer drops the rectangle drag", async ({ page }) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 3 });
  const layer = page.getByTestId("drag-layer").first();
  await expect(layer).toHaveAttribute("data-drawing", "1");
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="slide-host"]');
    host?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
  });
  await expect(layer).toHaveAttribute("data-drawing", "0");
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 3 });
  await expect(layer).toHaveAttribute("data-drawing", "0");
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(0);
});

test("a wheel zoom in the middle of a drag keeps the start on the slide and the corner under the pointer", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 250, { steps: 3 });
  const preview = page.getByTestId("drag-preview");
  const before = await cameraOf(page);
  const zoomBefore = Number(before.split(",")[2]);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => cameraOf(page)).not.toBe(before);
  await page.waitForTimeout(500);
  const zoomAfter = Number((await cameraOf(page)).split(",")[2]);
  const factor = 2 ** (zoomAfter - zoomBefore);
  expect(factor).toBeGreaterThan(1.2);
  const zoomed = pathPoints(await preview.getAttribute("d"));
  expect(Math.abs((zoomed[0]?.x ?? 0) - (300 + (200 - 300) * factor))).toBeLessThan(1);
  expect(Math.abs((zoomed[0]?.y ?? 0) - (250 + (200 - 250) * factor))).toBeLessThan(1);
  expect(Math.abs((zoomed[2]?.x ?? 0) - 300)).toBeLessThan(0.5);
  expect(Math.abs((zoomed[2]?.y ?? 0) - 250)).toBeLessThan(0.5);
  await page.mouse.move(box.x + 420, box.y + 330, { steps: 3 });
  const moved = pathPoints(await preview.getAttribute("d"));
  expect(Math.abs((moved[2]?.x ?? 0) - 420)).toBeLessThan(0.5);
  expect(Math.abs((moved[2]?.y ?? 0) - 330)).toBeLessThan(0.5);
  await page.mouse.up();
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const bounds = (await shape.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(bounds.x + bounds.width - (box.x + 420))).toBeLessThan(2);
  expect(Math.abs(bounds.y + bounds.height - (box.y + 330))).toBeLessThan(2);
});

test("a window resize in the middle of a drag keeps the start corner on its slide point", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 260, { steps: 3 });
  const preview = page.getByTestId("drag-preview");
  const camera = await cameraOf(page);
  const before = pathPoints(await preview.getAttribute("d"));
  await page.setViewportSize({ width: 1000, height: 720 });
  const shrunk = (await stage.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const shift = (shrunk.width - box.width) / 2;
  await expect.poll(() => cameraOf(page)).toBe(camera);
  await expect
    .poll(async () => {
      const after = pathPoints(await preview.getAttribute("d"));
      return Math.abs((after[0]?.x ?? 0) - ((before[0]?.x ?? 0) + shift));
    })
    .toBeLessThan(0.5);
  const after = pathPoints(await preview.getAttribute("d"));
  expect(Math.abs((after[2]?.x ?? 0) - 300)).toBeLessThan(0.5);
  expect(Math.abs((after[2]?.y ?? 0) - 260)).toBeLessThan(0.5);
  await page.mouse.up();
});

test("Alt draws a rectangle from its centre and Space held pans in the middle of a drag", async ({
  page,
}) => {
  const stage = await openSlide(page);
  const box = (await stage.boundingBox()) ?? { x: 0, y: 0 };
  await page.keyboard.press("r");
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 3 });
  const layer = page.getByTestId("drag-layer").first();
  await expect(layer).toHaveAttribute("data-from-centre", "true");
  const preview = pathPoints(await page.getByTestId("drag-preview").getAttribute("d"));
  expect(Math.abs((preview[0]?.x ?? 0) - 200)).toBeLessThan(0.5);
  expect(Math.abs((preview[0]?.y ?? 0) - 250)).toBeLessThan(0.5);
  expect(Math.abs((preview[2]?.x ?? 0) - 400)).toBeLessThan(0.5);
  await page.keyboard.up("Alt");
  const camera = await cameraOf(page);
  await page.keyboard.down("Space");
  await page.mouse.move(box.x + 350, box.y + 350, { steps: 3 });
  await page.keyboard.up("Space");
  await expect.poll(() => cameraOf(page)).not.toBe(camera);
  await expect(layer).toHaveAttribute("data-drawing", "1");
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 2 });
  await page.mouse.up();
  const shape = page.getByTestId("polygon-shape");
  await expect(shape).toHaveCount(1);
  const bounds = (await shape.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  expect(Math.abs(bounds.x + bounds.width - (box.x + 421))).toBeLessThan(2);
  expect(Math.abs(bounds.y + bounds.height - (box.y + 361))).toBeLessThan(2);
});
