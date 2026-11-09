import assert from "node:assert/strict";
import { test } from "node:test";
import {
  engineCameraOf,
  engineRing,
  overviewFrame,
  ringOfPath,
} from "../src/viewer/still-frame.ts";

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
