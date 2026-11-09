import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engineCameraOf,
  engineRing,
  overviewFrame,
  ringOfPath,
  stillCameraOf,
  stillShapeOf,
} from "../src/viewer/still-frame.ts";

test("an engine camera maps back to the still camera it came from", () => {
  const still = { x: 333, y: 1200, scale: 0.7 };
  const back = stillCameraOf(engineCameraOf(still, frame), frame);
  assert.ok(Math.abs(back.x - still.x) < 1e-6);
  assert.ok(Math.abs(back.y - still.y) < 1e-6);
  assert.ok(Math.abs(back.scale - still.scale) < 1e-9);
});

test("a slide ring becomes a still path whose box lands back on the slide ring", () => {
  const shape = stillShapeOf([100, 50, 300, 50, 300, 250], frame);
  const [x0, y0, x1, y1] = shape.box;
  assert.ok(Math.abs(x0 * frame.scale + frame.offsetX - 100) < 1e-6);
  assert.ok(Math.abs(y0 * frame.scale + frame.offsetY - 50) < 1e-6);
  assert.ok(Math.abs(x1 * frame.scale + frame.offsetX - 300) < 1e-6);
  assert.ok(Math.abs(y1 * frame.scale + frame.offsetY - 250) < 1e-6);
  assert.ok(shape.path.startsWith("M") && shape.path.endsWith("Z"));
  assert.equal(ringOfPath(shape.path).length, 6);
});

const frame = overviewFrame({ width: 1024, height: 768 });

test("the overview fits inside the slide and is centred", () => {
  assert.ok(Math.abs(frame.scale - 768 / 1924) < 1e-9);
  assert.equal(frame.offsetY, 0);
  assert.ok(frame.offsetX > 0);
});

test("the still centre lands on the engine centre of the fitted overview", () => {
  const camera = engineCameraOf({ x: 700, y: 962, scale: frame.scale }, frame);
  assert.ok(Math.abs(camera.x - 512) < 1e-6);
  assert.ok(Math.abs(camera.y - 384) < 1e-6);
  assert.ok(Math.abs(camera.zoom) < 1e-9);
});

test("doubling the still scale raises the engine zoom by one octave", () => {
  const one = engineCameraOf({ x: 0, y: 0, scale: 1 }, frame);
  const two = engineCameraOf({ x: 0, y: 0, scale: 2 }, frame);
  assert.ok(Math.abs(two.zoom - one.zoom - 1) < 1e-9);
});

test("a path becomes a flat ring and the ring moves into the slide frame", () => {
  const ring = ringOfPath("M10,20L30,40L50,60");
  assert.deepEqual([...ring], [10, 20, 30, 40, 50, 60]);
  const placed = engineRing(ring, frame);
  assert.ok(Math.abs((placed[0] ?? 0) - (10 * frame.scale + frame.offsetX)) < 1e-3);
  assert.ok(Math.abs((placed[1] ?? 0) - 20 * frame.scale) < 1e-3);
});
