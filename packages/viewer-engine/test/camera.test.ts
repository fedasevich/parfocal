import assert from "node:assert/strict";
import { test } from "node:test";
import { clampCamera, fitCamera, sameCamera, screenToSlide, slideToScreen } from "../src/index.ts";

const rect = { left: 100, top: 50, width: 800, height: 600 };
const limits = { minZoom: -10, maxZoom: 2 };

test("the viewport centre maps to the camera position", () => {
  const camera = { x: 5000, y: 3000, zoom: -2 };
  assert.deepEqual(screenToSlide(camera, rect, 500, 350), { x: 5000, y: 3000 });
});

test("one screen pixel covers 2 to the minus zoom slide pixels", () => {
  const camera = { x: 5000, y: 3000, zoom: -2 };
  assert.deepEqual(screenToSlide(camera, rect, 501, 352), { x: 5004, y: 3008 });
});

test("slide and screen coordinates round trip", () => {
  const camera = { x: 1234.5, y: 678.25, zoom: 1.5 };
  const point = { x: 1300, y: 600 };
  const screen = slideToScreen(camera, rect, point);
  const back = screenToSlide(camera, rect, screen.x, screen.y);
  assert.ok(Math.abs(back.x - point.x) < 1e-9);
  assert.ok(Math.abs(back.y - point.y) < 1e-9);
});

test("fitting centres the slide and fits its longer side", () => {
  const camera = fitCamera({ width: 8000, height: 3000 }, rect, limits);
  assert.equal(camera.x, 4000);
  assert.equal(camera.y, 1500);
  assert.equal(camera.zoom, Math.log2(800 / 8000));
});

test("fitting an empty viewport falls back to the minimum zoom", () => {
  const camera = fitCamera({ width: 8000, height: 3000 }, { width: 0, height: 0 }, limits);
  assert.equal(camera.zoom, limits.minZoom);
});

test("clamping keeps the zoom inside the limits and the same object when inside", () => {
  const inside = { x: 1, y: 2, zoom: 0 };
  assert.equal(clampCamera(inside, limits), inside);
  assert.equal(clampCamera({ x: 1, y: 2, zoom: 9 }, limits).zoom, 2);
  assert.equal(clampCamera({ x: 1, y: 2, zoom: -40 }, limits).zoom, -10);
});

test("cameras compare by value", () => {
  assert.ok(sameCamera({ x: 1, y: 2, zoom: 3 }, { x: 1, y: 2, zoom: 3 }));
  assert.ok(!sameCamera({ x: 1, y: 2, zoom: 3 }, { x: 1, y: 2.5, zoom: 3 }));
});
