import assert from "node:assert/strict";
import { test } from "node:test";
import { routePath } from "../src/feedback/feedback-state.ts";
import {
  blurAreas,
  mosaic,
  mosaicBlock,
  phiSelector,
  snappedArea,
} from "../src/feedback/phi-areas.ts";

function stripes(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const value = x % 2 === 0 ? 0 : 255;
      data.set([value, value, value, 255], at);
    }
  }
  return { width, height, data };
}

function pixel(image: ReturnType<typeof stripes>, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return Array.from(image.data.slice(at, at + 4));
}

test("areas grow by a margin and stay inside the frame", () => {
  const frame = { width: 100, height: 80 };
  assert.deepEqual(
    blurAreas(
      [
        { x: 10, y: 10, width: 20, height: 20 },
        { x: -40, y: 70, width: 60, height: 40 },
        { x: 120, y: 10, width: 20, height: 20 },
        { x: 5, y: 5, width: 0, height: 10 },
      ],
      frame,
    ),
    [
      { x: 4, y: 4, width: 32, height: 32 },
      { x: 0, y: 64, width: 26, height: 16 },
    ],
  );
});

test("an area snaps outward to whole mosaic blocks", () => {
  assert.deepEqual(snappedArea({ x: 20, y: 3, width: 10, height: 30 }), {
    x: 16,
    y: 0,
    width: 16,
    height: 48,
  });
});

test("the mosaic turns every block over a patient area into one colour and leaves the rest", () => {
  const image = stripes(64, 32);
  mosaic(image, [{ x: 0, y: 0, width: 20, height: 10 }]);
  for (let y = 0; y < mosaicBlock; y += 1) {
    for (let x = 0; x < 2 * mosaicBlock; x += 1) {
      assert.deepEqual(pixel(image, x, y), [128, 128, 128, 255]);
    }
  }
  assert.deepEqual(pixel(image, 40, 4), [0, 0, 0, 255]);
  assert.deepEqual(pixel(image, 41, 4), [255, 255, 255, 255]);
  assert.deepEqual(pixel(image, 1, 20), [255, 255, 255, 255]);
});

test("slides, images, patient details and typed text are all areas to blur", () => {
  for (const part of [
    "canvas",
    "img",
    "video",
    "[data-phi]",
    "[data-testid='patient-banner']",
    "[data-testid='slide-row']",
    "nav[aria-label='breadcrumb']",
    "tbody",
    "input",
  ]) {
    assert.ok(phiSelector.split(", ").includes(part), part);
  }
});

test("the route sent with feedback keeps ids and drops the query and odd characters", () => {
  assert.equal(routePath("/projects/7c/slides/9a"), "/projects/7c/slides/9a");
  assert.equal(routePath("/search Smith, J"), "/searchSmithJ");
  assert.equal(routePath("x".repeat(400)).length, 300);
});
