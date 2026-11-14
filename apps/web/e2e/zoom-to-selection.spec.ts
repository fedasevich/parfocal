import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const marginPx = 48;

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

async function settled(page: Page) {
  const host = page.getByTestId("slide-host");
  let last = await host.getAttribute("data-camera");
  await expect
    .poll(async () => {
      await page.waitForTimeout(300);
      const now = await host.getAttribute("data-camera");
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
}

const boxOf = async (page: Page, testId: string, inner?: string) => {
  const node = page.getByTestId(testId);
  const box = await (inner ? node.locator(inner).first() : node).boundingBox();
  if (box === null) throw new Error(`${testId} has no box`);
  return box;
};

test("Shift+F fits the selected shape on the live stage with a 48 px margin", async ({ page }) => {
  await openSlide(page);
  const host = await boxOf(page, "slide-host");
  const centre = { x: host.x + host.width / 2, y: host.y + host.height / 2 };
  await page.keyboard.press("r");
  await page.mouse.move(centre.x - 90, centre.y - 30);
  await page.mouse.down();
  await page.mouse.move(centre.x + 30, centre.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId("polygon-shape")).toHaveCount(1);
  await page.keyboard.press("v");
  await expect(page.getByTestId("slide-stage")).toHaveAttribute("data-tool", "select");
  await page.mouse.click(centre.x - 30, centre.y);
  await expect(page.getByTestId("select-layer")).toHaveAttribute("data-selected", "1");
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");

  await page.keyboard.press("Shift+F");
  await expect
    .poll(() => page.getByTestId("slide-host").getAttribute("data-camera"))
    .not.toBe(camera);
  await settled(page);

  const shape = await boxOf(page, "select-outline", "path");
  const left = shape.x - host.x;
  const right = host.x + host.width - (shape.x + shape.width);
  const top = shape.y - host.y;
  const bottom = host.y + host.height - (shape.y + shape.height);
  expect(Math.abs(left - right)).toBeLessThan(3);
  expect(Math.abs(top - bottom)).toBeLessThan(3);
  expect(Math.abs(Math.min(left, top) - marginPx)).toBeLessThan(3);
  expect(Math.max(left, top)).toBeGreaterThanOrEqual(marginPx);
});

test("Shift+F leaves the camera alone when nothing is selected", async ({ page }) => {
  await openSlide(page);
  await settled(page);
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");
  await page.keyboard.press("Shift+F");
  await page.waitForTimeout(600);
  expect(await page.getByTestId("slide-host").getAttribute("data-camera")).toBe(camera);
});

test("Shift+F fits the focused AI area when no shape is selected", async ({ page }) => {
  await openSlide(page);
  const nav = page.getByTestId("area-nav");
  await page.keyboard.press("]");
  await expect(nav).toHaveAttribute("data-current", "T1");
  await page.waitForTimeout(1500);
  await settled(page);
  const camera = await page.getByTestId("slide-host").getAttribute("data-camera");
  await page.keyboard.press("Shift+F");
  await expect
    .poll(() => page.getByTestId("slide-host").getAttribute("data-camera"))
    .not.toBe(camera);
});
