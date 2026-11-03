import { expect, test } from "@playwright/test";
import { assertSwiftShader } from "../../golden-images/src/playwright.ts";
import { harnessUrl } from "./cdp.ts";
import type { PanSlide } from "./page/pan-harness.ts";

test("back after a jump flies to the old view on a real canvas and forward returns", async ({
  page,
}) => {
  await page.setContent("<!doctype html><html><body></body></html>");
  await assertSwiftShader(page);
  await page.goto(harnessUrl("/app/pan.html"));
  await page.waitForFunction(() => window.panHarness !== undefined);
  const slide: PanSlide = {
    url: harnessUrl("/synthetic/synthetic-jpeg.tiff"),
    formatId: "generic-tiff",
    workers: 0,
    reader: "shared-bytes",
    magnification: null,
    x: 0,
    y: 0,
  };
  await page.evaluate((next) => window.panHarness.open(next), slide);
  const old = await page.evaluate(() => window.panHarness.rest());
  const jumped = await page.evaluate(
    (from) => window.panHarness.flyTo({ x: from.x * 1.2, y: from.y * 0.8, zoom: from.zoom + 1.5 }),
    old,
  );
  expect(jumped).not.toEqual(old);
  expect(await page.evaluate(() => window.panHarness.back())).toEqual(old);
  expect(await page.evaluate(() => window.panHarness.back())).toBeNull();
  expect(await page.evaluate(() => window.panHarness.forward())).toEqual(jumped);
  await page.evaluate(() => window.panHarness.close());
});
