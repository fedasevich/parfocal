import { expect, type Page, test } from "@playwright/test";

const rt14 = "00000000-0000-4000-8007-000000000014";
const a1 = "00000000-0000-4000-8005-000000000001";
const outlinedSlide = "00000000-0000-4000-8005-000000000004";

const firstOutline = { left: 120, top: 120, right: 380, bottom: 360 };

const engine = (page: Page) => page.getByTestId("still-engine");
const still = (page: Page) => page.locator('[data-slot="slide-still"]');

async function fullViewerHref(page: Page) {
  await page.goto("/prototype");
  const link = page
    .getByRole("list", { name: "Screens" })
    .getByRole("link", { name: "Full viewer · Objects tab", exact: true });
  return ((await link.getAttribute("href")) ?? "").replace(a1, outlinedSlide);
}

async function engineReady(page: Page) {
  await expect(engine(page)).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(engine(page).locator("canvas").first()).toBeVisible();
}

const numbers = (text: string | null) => (text ?? "").split(",").map(Number);

async function cameras(page: Page) {
  const [x = 0, y = 0, scale = 1] = numbers(await still(page).getAttribute("data-camera"));
  const [frameScale = 1, offsetX = 0, offsetY = 0] = numbers(
    await engine(page).getAttribute("data-frame"),
  );
  const [engineX = 0, engineY = 0, zoom = 0] = numbers(
    await engine(page).getAttribute("data-camera"),
  );
  return {
    expected: {
      x: x * frameScale + offsetX,
      y: y * frameScale + offsetY,
      zoom: Math.log2(scale / frameScale),
    },
    engine: { x: engineX, y: engineY, zoom },
    stillScale: scale,
  };
}

async function expectAligned(page: Page) {
  await expect
    .poll(async () => {
      const { expected, engine: shown } = await cameras(page);
      return (
        Math.abs(expected.x - shown.x) < 0.5 &&
        Math.abs(expected.y - shown.y) < 0.5 &&
        Math.abs(expected.zoom - shown.zoom) < 1e-3
      );
    })
    .toBe(true);
  const { engine: shown } = await cameras(page);
  const box = await still(page).boundingBox();
  if (box === null) throw new Error("the still has no box");
  const pixels = 2 ** shown.zoom;
  const toScreen = (x: number, y: number) => ({
    x: box.x + box.width / 2 + (x - shown.x) * pixels,
    y: box.y + box.height / 2 + (y - shown.y) * pixels,
  });
  const from = toScreen(firstOutline.left, firstOutline.top);
  const to = toScreen(firstOutline.right, firstOutline.bottom);
  const outline = await still(page)
    .locator('svg[role="img"] > g > path')
    .first()
    .evaluate((path: SVGGraphicsElement) => {
      const geometry = path.getBBox();
      const matrix = path.getScreenCTM();
      if (matrix === null) return null;
      const corner = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(matrix);
      const start = corner(geometry.x, geometry.y);
      const end = corner(geometry.x + geometry.width, geometry.y + geometry.height);
      return { left: start.x, top: start.y, right: end.x, bottom: end.y };
    });
  if (outline === null) throw new Error("the current outline has no box");
  expect(Math.abs(outline.left - from.x)).toBeLessThan(1);
  expect(Math.abs(outline.top - from.y)).toBeLessThan(1);
  expect(Math.abs(outline.right - to.x)).toBeLessThan(1);
  expect(Math.abs(outline.bottom - to.y)).toBeLessThan(1);
}

async function wheelOutAndDragAway(page: Page) {
  const box = await still(page).boundingBox();
  if (box === null) throw new Error("the still has no box");
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  for (let step = 0; step < 30; step += 1) await page.mouse.wheel(0, 120);
  const floor = (await cameras(page)).stillScale;
  await page.mouse.wheel(0, 120);
  expect((await cameras(page)).stillScale).toBeCloseTo(floor, 5);
  await expectAligned(page);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + box.width * 3, centre.y + box.height * 3, { steps: 8 });
  await page.mouse.up();
  const after = await cameras(page);
  expect(after.engine.x).toBeGreaterThanOrEqual(-0.5);
  expect(after.engine.y).toBeGreaterThanOrEqual(-0.5);
  await expectAligned(page);
}

async function leave(page: Page) {
  const from = page.url();
  await page
    .getByRole("link", { name: /My work/ })
    .first()
    .click();
  await expect.poll(() => page.url()).not.toBe(from);
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("guided review draws the real outlines of a slide outside the mock and keeps them aligned", async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto(`/tasks/${rt14}/guided?slide=${outlinedSlide}`);
  await engineReady(page);
  await expect(engine(page)).toHaveAttribute("data-objects", "2");
  expect(Number(await engine(page).getAttribute("data-overlays"))).toBeGreaterThan(0);
  await expect(still(page).locator('svg[role="img"] > g > path')).toHaveCount(1);
  await expectAligned(page);
  await wheelOutAndDragAway(page);
  await leave(page);
  await expect(engine(page)).toHaveCount(0);
  expect(errors.filter((text) => /engine|disposed|WebGL/i.test(text))).toEqual([]);
});

test("the full viewer draws the real outlines of a slide outside the mock and keeps them aligned", async ({
  page,
}) => {
  const href = await fullViewerHref(page);
  const errors = watchErrors(page);
  await page.goto(href);
  await engineReady(page);
  await expect(engine(page)).toHaveAttribute("data-objects", "3");
  expect(Number(await engine(page).getAttribute("data-overlays"))).toBeGreaterThan(0);
  await page.getByRole("button", { name: /R1/ }).first().click();
  await expect(engine(page)).toHaveAttribute("data-objects", "2");
  await expectAligned(page);
  await wheelOutAndDragAway(page);
  await leave(page);
  await expect(engine(page)).toHaveCount(0);
  expect(errors.filter((text) => /engine|disposed|WebGL/i.test(text))).toEqual([]);
});

test("with WebGL off the still draws the real outlines and the region home over its own image", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const prototype = HTMLCanvasElement.prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, "getContext")?.value as (
      this: HTMLCanvasElement,
      kind: string,
      options?: unknown,
    ) => RenderingContext | null;
    prototype.getContext = function (this: HTMLCanvasElement, kind: string, options?: unknown) {
      if (kind.startsWith("webgl")) return null;
      return original.call(this, kind, options);
    } as typeof prototype.getContext;
  });
  await page.goto(`/tasks/${rt14}/guided?slide=${outlinedSlide}`);
  await expect(still(page).locator("svg image")).toHaveCount(1);
  await expect(engine(page)).toHaveCount(0);
  await expect(still(page).locator('svg[role="img"] > g > path')).toHaveCount(3);
  const [x = 0, y = 0] = numbers(await still(page).getAttribute("data-camera"));
  const frameScale = 768 / 1924;
  const offsetX = (1024 - 1400 * frameScale) / 2;
  expect(Math.abs(x * frameScale + offsetX - 250)).toBeLessThan(1);
  expect(Math.abs(y * frameScale - 240)).toBeLessThan(1);
});
