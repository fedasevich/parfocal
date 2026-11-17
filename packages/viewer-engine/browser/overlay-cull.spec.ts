import { expect, test } from "@playwright/test";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";

const perRow = 400;
const nucleusDiagonal = Math.hypot(6, 6);

test("the Viv route culls a large nuclei layer to a window around the view and moves the window on a pan", async ({
  page,
}) => {
  await page.goto(harnessUrl("/app/overlay-cull.html"));
  await page.waitForFunction(() => window.cullHarness !== undefined);
  await assertSwiftShader(page);
  const opened = await page.evaluate(({ url, perRow }) => window.cullHarness.open(url, perRow), {
    url: harnessUrl("/synthetic/synthetic-zlib.ome.tiff"),
    perRow,
  });
  expect(opened.total).toBe(perRow * perRow);

  const zoom = Math.log2(20 / nucleusDiagonal);
  const centre = { x: opened.width / 2, y: opened.height / 2, zoom };
  const first = await page.evaluate((camera) => window.cullHarness.show(camera), centre);
  expect(first.errors).toEqual([]);
  expect(first.layers.some((layer) => layer.id.includes("outlines") && layer.visible)).toBe(true);
  expect(first.touching).toBeGreaterThan(100);
  expect(first.touchingMissing).toBe(0);
  expect(first.drawnShapes).toBeGreaterThanOrEqual(first.touching);
  expect(first.drawnShapes).toBeLessThan(opened.total / 20);

  const viewWidth = first.view[2] - first.view[0];
  const panned = await page.evaluate((camera) => window.cullHarness.show(camera), {
    ...centre,
    x: centre.x + viewWidth,
  });
  expect(panned.errors).toEqual([]);
  expect(panned.touching).toBeGreaterThan(100);
  expect(panned.touchingMissing).toBe(0);
  expect(panned.drawnShapes).toBeLessThan(opened.total / 20);
  expect(panned.drawnKeys).not.toEqual(first.drawnKeys);
  console.log(
    `Cull: ${opened.total} shapes, centre ${first.drawnShapes} drawn for ${first.touching} touching, panned ${panned.drawnShapes} drawn for ${panned.touching} touching`,
  );

  await page.evaluate(() => window.cullHarness.close());
});
