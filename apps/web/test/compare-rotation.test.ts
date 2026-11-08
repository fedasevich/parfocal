import assert from "node:assert/strict";
import { test } from "node:test";
import { createLinkedViews, relinkViews, unlinkViews } from "@parfocal/viewer-engine";
import {
  moveCameraKeepingRotation,
  rotatePane,
  rotationOfView,
  wrapDegrees,
} from "../src/screens/viewer-tools/link-camera.ts";

const panes = ["left", "right"] as const;
const camera = { x: 100, y: 200, scale: 1 };

const unlinkedWithViews = () => {
  const start = moveCameraKeepingRotation(unlinkViews(createLinkedViews(panes)), "left", camera);
  return moveCameraKeepingRotation(start, "right", camera);
};

test("rotating one pane while linked turns both", () => {
  const turned = rotatePane(createLinkedViews(panes), "left", camera, { by: 15 });
  assert.equal(rotationOfView(turned.views.left), 15);
  assert.equal(rotationOfView(turned.views.right), 15);
});

test("rotating while unlinked turns only that pane", () => {
  const turned = rotatePane(unlinkedWithViews(), "right", camera, { by: 30 });
  assert.equal(rotationOfView(turned.views.left), 0);
  assert.equal(rotationOfView(turned.views.right), 30);
});

test("relinking keeps the rotation difference between panes", () => {
  let state = rotatePane(unlinkedWithViews(), "right", camera, { by: 45 });
  state = relinkViews(state, "left");
  state = rotatePane(state, "left", camera, { by: 15 });
  assert.equal(rotationOfView(state.views.left), 15);
  assert.equal(rotationOfView(state.views.right), 60);
});

test("panning a rotated pane keeps its rotation", () => {
  let state = rotatePane(createLinkedViews(panes), "left", camera, { by: 90 });
  state = moveCameraKeepingRotation(state, "left", { x: 300, y: 200, scale: 2 });
  assert.equal(rotationOfView(state.views.left), 90);
  assert.equal(rotationOfView(state.views.right), 90);
  assert.equal(state.views.right?.x, 300);
});

test("reset returns a pane to zero and angles wrap", () => {
  const turned = rotatePane(createLinkedViews(panes), "left", camera, { by: 170 });
  const over = rotatePane(turned, "left", camera, { by: 30 });
  assert.equal(rotationOfView(over.views.left), -160);
  assert.equal(rotationOfView(rotatePane(over, "left", camera, { to: 0 }).views.left), 0);
  assert.equal(wrapDegrees(180), -180);
  assert.equal(wrapDegrees(-190), 170);
});
