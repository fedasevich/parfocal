import assert from "node:assert/strict";
import { test } from "node:test";
import { distance } from "../src/measure/ruler-maths.ts";
import {
  areaOutline,
  fitArea,
  largestMeasurement,
  lineMm,
  preDrawnLine,
  regionOutline,
} from "../src/screens/viewer-tools/area-measure.ts";

const ellipse = Array.from({ length: 36 }, (_, index) => {
  const angle = (index / 36) * 2 * Math.PI;
  return { x: 500 + 120 * Math.cos(angle), y: 300 + 40 * Math.sin(angle) };
});

test("the pre-drawn line runs along the long axis of an area outline", () => {
  const line = preDrawnLine(ellipse);
  assert.ok(line);
  assert.equal(Math.round(distance(line.from, line.to)), 240);
  assert.equal(Math.round(line.from.y), 300);
  assert.equal(Math.round(line.to.y), 300);
});

test("the pre-drawn line on the lead area joins two points of its outline", () => {
  const outline = areaOutline("T1");
  const line = preDrawnLine(outline);
  assert.ok(line);
  const onOutline = (point: { x: number; y: number }) =>
    outline.some((item) => item.x === point.x && item.y === point.y);
  assert.ok(onOutline(line.from) && onOutline(line.to));
  const longest = outline.reduce(
    (best, a) => outline.reduce((inner, b) => Math.max(inner, distance(a, b)), best),
    0,
  );
  assert.equal(distance(line.from, line.to), longest);
});

test("an outline in slide pixels maps onto the overview still before the line is drawn", () => {
  const ring = [0, 0, 400, 0, 400, 100, 0, 100];
  const outline = regionOutline({ object: "R1", outline: ring }, { width: 1400, height: 1924 });
  assert.deepEqual(outline[1], { x: 400, y: 0 });
  const line = preDrawnLine(outline);
  assert.ok(line);
  assert.equal(Math.round(distance(line.from, line.to)), 412);
  assert.equal(regionOutline({ object: "T1⁺" }, null).length, areaOutline("T1").length);
});

test("an outline with fewer than two points has no pre-drawn line", () => {
  assert.equal(preDrawnLine([]), null);
  assert.equal(areaOutline("nowhere").length, 0);
});

test("the camera fits the whole area with a margin around it", () => {
  const view = { width: 800, height: 600 };
  const camera = fitArea(ellipse, view);
  assert.ok(camera);
  assert.deepEqual([Math.round(camera.x), Math.round(camera.y)], [500, 300]);
  const shownWidth = view.width / camera.scale;
  assert.ok(shownWidth > 240 && shownWidth < 240 * 1.5);
  assert.equal(fitArea([], view), null);
});

test("the line reads the AI size when untouched and scales with its length", () => {
  const axis = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
  assert.equal(lineMm(axis, axis, 7.7), 7.7);
  assert.equal(lineMm({ from: { x: 0, y: 0 }, to: { x: 0, y: 120 } }, axis, 7.7), 9.24);
});

test("the largest measurement is the one that feeds the report", () => {
  const measurements = [
    { across: "T2", mm: 6.1 },
    { across: "T1", mm: 8.2 },
    { across: "T3", mm: 1.2 },
  ];
  assert.equal(largestMeasurement(measurements)?.across, "T1");
  assert.equal(largestMeasurement([]), null);
});
