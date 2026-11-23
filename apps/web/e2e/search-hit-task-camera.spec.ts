import type { Page } from "@playwright/test";
import { expect, test } from "./telemetry-capture.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";
const tumor044 = "00000000-0000-4000-8005-000000000005";
const annotateTask = "00000000-0000-4000-8007-000000000021";

type Camera = { x: number; y: number; zoom: number };

test.describe.configure({ timeout: 90_000 });

const reach = 2;
const screenReach = 24;
const aboveFit = 0.02;

async function cameraOf(page: Page): Promise<Camera | null> {
  const text = await page.getByTestId("slide-host").getAttribute("data-camera");
  const [x, y, zoom] = (text ?? "").split(",").map(Number);
  if (x === undefined || y === undefined || zoom === undefined) return null;
  return [x, y, zoom].some(Number.isNaN) ? null : { x, y, zoom };
}

async function stageReady(page: Page) {
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

async function fitZoomOf(page: Page, url: string): Promise<number> {
  await page.goto(url);
  await stageReady(page);
  let zoom = Number.NaN;
  await expect
    .poll(async () => {
      const camera = await cameraOf(page);
      if (camera === null) return false;
      const settled = camera.zoom === zoom;
      zoom = camera.zoom;
      return settled;
    })
    .toBe(true);
  return zoom;
}

async function expectZoomAbove(page: Page, fitZoom: number) {
  await expect
    .poll(async () => (await cameraOf(page))?.zoom ?? -Infinity, { timeout: 20_000 })
    .toBeGreaterThan(fitZoom + aboveFit);
}

async function screenOffsetOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((wanted) => {
    const element = document.querySelector(wanted);
    const host = document.querySelector('[data-testid="slide-host"]');
    if (element === null || host === null) return Infinity;
    const box = element.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    return Math.hypot(
      box.x + box.width / 2 - (frame.x + frame.width / 2),
      box.y + box.height / 2 - (frame.y + frame.height / 2),
    );
  }, selector);
}

test("a drawn object hit inside a review task lands on the object and picks it", async ({
  page,
}) => {
  const slide = `/projects/${p07}/slides/${a1}?task=${rt14}&source=drawn`;
  const fitZoom = await fitZoomOf(page, slide);
  const objects = await page.evaluate(
    async ([task, slideId]) => {
      const response = await fetch(`/api/review-tasks/${task}/slides/${slideId}/objects`);
      const body = (await response.json()) as {
        objects: { object: string; drawn?: boolean; outline: number[] | null }[];
      };
      return body.objects;
    },
    [rt14, a1] as const,
  );
  const drawn = objects.find((item) => item.drawn === true && item.outline !== null);
  if (drawn?.outline === null || drawn?.outline === undefined) throw new Error("no drawn object");
  const xs = drawn.outline.filter((_, index) => index % 2 === 0);
  const ys = drawn.outline.filter((_, index) => index % 2 === 1);
  const centre = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  await page.goto(`${slide}&object=${drawn.object}%2B`);
  await stageReady(page);
  await expect(page.getByTestId("stage-review-objects")).toHaveAttribute(
    "data-current",
    drawn.object,
  );
  await expect
    .poll(
      async () => {
        const camera = await cameraOf(page);
        return camera === null ? Infinity : Math.hypot(camera.x - centre.x, camera.y - centre.y);
      },
      { timeout: 20_000 },
    )
    .toBeLessThan(reach);
  await expectZoomAbove(page, fitZoom);
});

test("a cell hit inside an annotate task lands on the cell and picks it", async ({ page }) => {
  const slide = `/projects/${p07}/slides/${tumor044}?task=${annotateTask}&as=DH`;
  const fitZoom = await fitZoomOf(page, slide);
  await page.goto(`${slide}&object=C3`);
  await stageReady(page);
  const cell = '[data-testid="ai-object"][data-object="C3"]';
  await expect(page.locator(cell)).toHaveAttribute("data-selected", "true", { timeout: 30_000 });
  await expectZoomAbove(page, fitZoom);
  await expect
    .poll(() => screenOffsetOf(page, cell), { timeout: 20_000 })
    .toBeLessThan(screenReach);
});
