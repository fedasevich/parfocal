import assert from "node:assert/strict";
import { test } from "node:test";
import { createLinkedViews, moveView, relinkViews, unlinkViews } from "@parfocal/viewer-engine";
import {
  carryPoint,
  pointOfScreen,
  screenOfPoint,
} from "../src/screens/viewer-tools/cursor-map.ts";

const box = { width: 800, height: 600 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`);
const panes = ["left", "right"] as const;

test("screen and slide points round trip with zoom and rotation", () => {
  const view = { x: 500, y: 300, zoom: 1.5, rotation: 37 };
  const screen = { x: 123, y: 456 };
  const back = screenOfPoint(view, box, pointOfScreen(view, box, screen));
  near(back.x, screen.x);
  near(back.y, screen.y);
});

test("a flipped pane mirrors the screen position", () => {
  const view = { x: 0, y: 0, zoom: 0, rotation: 0 };
  const point = { x: 100, y: 50 };
  const plain = screenOfPoint(view, box, point);
  const mirrored = screenOfPoint(view, box, point, true);
  near(mirrored.x, box.width - plain.x);
  near(mirrored.y, plain.y);
  const back = pointOfScreen(view, box, mirrored, true);
  near(back.x, 100);
  near(back.y, 50);
});

test("the view centre lands in the middle of the pane", () => {
  const centre = screenOfPoint({ x: 40, y: 80, zoom: 2, rotation: 90 }, box, { x: 40, y: 80 });
  near(centre.x, 400);
  near(centre.y, 300);
});

test("a quarter turn sends a point right of centre to below centre", () => {
  const screen = screenOfPoint({ x: 0, y: 0, zoom: 0, rotation: 90 }, box, { x: 10, y: 0 });
  near(screen.x, 400);
  near(screen.y, 310);
});

test("the cursor follows the other pane through its kept offset", () => {
  let state = unlinkViews(createLinkedViews(panes));
  state = moveView(state, "left", { x: 100, y: 100, zoom: 0, rotation: 0 });
  state = moveView(state, "right", { x: 160, y: 130, zoom: 0, rotation: 0 });
  state = relinkViews(state, "left");
  const onLeft = { x: 120, y: 110 };
  const onRight = carryPoint(onLeft, state.offsets.left, state.offsets.right);
  assert.deepEqual(onRight, { x: 180, y: 140 });
  assert.ok(state.views.left && state.views.right);
  const a = screenOfPoint(state.views.left, box, onLeft);
  const b = screenOfPoint(state.views.right, box, onRight);
  near(a.x, b.x);
  near(a.y, b.y);
});

test("after panning and zooming the linked pair the cursor stays level on both panes", () => {
  let state = unlinkViews(createLinkedViews(panes));
  state = moveView(state, "left", { x: 0, y: 0, zoom: 0, rotation: 0 });
  state = moveView(state, "right", { x: 50, y: 0, zoom: 0, rotation: 0 });
  state = relinkViews(state, "left");
  state = moveView(state, "left", { x: 300, y: 200, zoom: 0, rotation: 0 });
  const point = { x: 320, y: 210 };
  const other = carryPoint(point, state.offsets.left, state.offsets.right);
  assert.ok(state.views.left && state.views.right);
  const a = screenOfPoint(state.views.left, box, point);
  const b = screenOfPoint(state.views.right, box, other);
  near(a.x, b.x);
  near(a.y, b.y);
});

test("an unlinked pane keeps the offset from the last link", () => {
  let state = unlinkViews(createLinkedViews(panes));
  state = moveView(state, "left", { x: 0, y: 0, zoom: 0, rotation: 0 });
  state = moveView(state, "right", { x: 50, y: 0, zoom: 0, rotation: 0 });
  state = relinkViews(state, "left");
  state = unlinkViews(state);
  state = moveView(state, "right", { x: 900, y: 900, zoom: 0, rotation: 0 });
  const other = carryPoint({ x: 10, y: 10 }, state.offsets.left, state.offsets.right);
  assert.deepEqual(other, { x: 60, y: 10 });
});

test("a rotated pane turns the cursor around its own centre", () => {
  const view = { x: 0, y: 0, zoom: 0, rotation: 90 };
  const slide = pointOfScreen(view, box, { x: 400, y: 310 });
  near(slide.x, 10);
  near(slide.y, 0);
});
