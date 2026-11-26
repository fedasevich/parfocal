import { expect, type Page, test } from "./a11y.ts";

const p07 = "00000000-0000-4000-8003-000000000007";
const a1 = "00000000-0000-4000-8005-000000000001";
const rt14 = "00000000-0000-4000-8007-000000000014";

const slideWidth = 1024;
const slideHeight = 768;
const alignedWithin = 1;
const mapName = "The whole slide. Click a place to go there";

async function openPeek(page: Page) {
  await page.goto(`/projects/${p07}/slides/${a1}?task=${rt14}&as=LM`);
  const stage = page.getByTestId("slide-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 20_000 });
  await expect(stage).toHaveAttribute("data-coverage", "loaded");
  await page.keyboard.press("z");
  const peek = page.getByTestId("viewed-peek");
  await expect(peek).toBeVisible();
  await expect(peek).toHaveAttribute("data-source", "sharp", { timeout: 20_000 });
  return peek;
}

async function checkSharpMap(page: Page, pixelRatio: number) {
  const peek = await openPeek(page);
  const map = peek.getByRole("img", { name: mapName });
  await expect
    .poll(() =>
      map.evaluate(
        (element) =>
          Math.abs(
            element.getBoundingClientRect().width -
              Number.parseFloat(getComputedStyle(element).width),
          ) < 0.01,
      ),
    )
    .toBe(true);
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  const dialogPixels = (box?.width ?? 0) * pixelRatio;
  await expect
    .poll(async () => Number(await peek.getAttribute("data-picture-width")))
    .toBeGreaterThanOrEqual(dialogPixels);
  const href = (await peek.locator("image").getAttribute("href")) ?? "";
  expect(href).toMatch(/^blob:/);
  const picture = await page.evaluate(
    (source) =>
      new Promise<number>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth);
        image.src = source;
      }),
    href,
  );
  expect(picture).toBeGreaterThanOrEqual(dialogPixels);
  expect(Number(await peek.getAttribute("data-picture-width"))).toBe(picture);

  const layer = await peek.locator("image").boundingBox();
  expect(Math.abs((layer?.x ?? 0) - (box?.x ?? 0))).toBeLessThan(1);
  expect(Math.abs((layer?.width ?? 0) - (box?.width ?? 0))).toBeLessThan(1);
  expect(Math.abs((layer?.height ?? 0) - (box?.height ?? 0))).toBeLessThan(1);

  const outline = await page.evaluate(
    async ([task, slide]) => {
      const body = (await (
        await fetch(`/api/review-tasks/${task}/slides/${slide}/objects`)
      ).json()) as { objects: { object: string; outline?: number[] }[] };
      return body.objects.find((item) => item.object === "T1")?.outline ?? [];
    },
    [rt14, a1],
  );
  expect(outline.length).toBeGreaterThanOrEqual(6);
  const xs = outline.filter((_, index) => index % 2 === 0);
  const ys = outline.filter((_, index) => index % 2 === 1);
  const expected = {
    x: (box?.x ?? 0) + (Math.min(...xs) / slideWidth) * (box?.width ?? 0),
    y: (box?.y ?? 0) + (Math.min(...ys) / slideHeight) * (box?.height ?? 0),
    width: ((Math.max(...xs) - Math.min(...xs)) / slideWidth) * (box?.width ?? 0),
    height: ((Math.max(...ys) - Math.min(...ys)) / slideHeight) * (box?.height ?? 0),
  };
  const region = await peek
    .locator("[data-slot=peek-area] path")
    .first()
    .evaluate((path: SVGGraphicsElement) => {
      const shape = path.getBBox();
      const map = path.getScreenCTM();
      const corner = new DOMPoint(shape.x, shape.y).matrixTransform(map ?? undefined);
      const far = new DOMPoint(shape.x + shape.width, shape.y + shape.height).matrixTransform(
        map ?? undefined,
      );
      return { x: corner.x, y: corner.y, width: far.x - corner.x, height: far.y - corner.y };
    });
  expect(Math.abs(region.x - expected.x)).toBeLessThan(alignedWithin);
  expect(Math.abs(region.y - expected.y)).toBeLessThan(alignedWithin);
  expect(Math.abs(region.width - expected.width)).toBeLessThan(alignedWithin);
  expect(Math.abs(region.height - expected.height)).toBeLessThan(alignedWithin);
  return { picture, dialog: box?.width ?? 0 };
}

test.describe("on a normal screen", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the whole slide map picture is at least as wide as the dialog, aligned with its areas", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const { picture, dialog } = await checkSharpMap(page, 1);
    expect(dialog).toBeGreaterThan(600);
    expect(picture).toBeGreaterThanOrEqual(Math.ceil(dialog));
  });
});

test.describe("on a dense screen", () => {
  test.use({ viewport: { width: 1000, height: 500 }, deviceScaleFactor: 2 });

  test("the whole slide map picture covers the dialog times the pixel ratio", async ({ page }) => {
    test.setTimeout(60_000);
    const { picture, dialog } = await checkSharpMap(page, 2);
    expect(dialog).toBeLessThan(512);
    expect(picture).toBeGreaterThanOrEqual(Math.ceil(dialog * 2));
  });
});
