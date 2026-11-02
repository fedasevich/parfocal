import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alignViews,
  createLinkedViews,
  type LinkedView,
  type LinkedViews,
  moveView,
  noOffset,
  offsetBetween,
  relinkViews,
  shiftView,
  toggleLinked,
  unlinkViews,
} from "../src/index.ts";

const home: LinkedView = { x: 1000, y: 800, zoom: -3, rotation: 0 };
const panes = ["left", "right"] as const;

test("linked panes copy every pan, zoom and rotation of the pane that moved", () => {
  const moved: LinkedView = { x: 1500, y: 900, zoom: -1, rotation: 30 };
  const state = moveView(createLinkedViews(panes, home), "left", moved);
  assert.deepEqual(state.views.left, moved);
  assert.deepEqual(state.views.right, moved);
  const back = moveView(state, "right", home);
  assert.deepEqual(back.views.left, home);
});

test("moving a pane back to home takes the others home", () => {
  const state = moveView(createLinkedViews(panes, home), "right", null);
  assert.deepEqual(state.views, { left: null, right: null });
});

test("unlinked panes move alone", () => {
  const apart = moveView(unlinkViews(createLinkedViews(panes, home)), "right", {
    ...home,
    x: 1400,
  });
  assert.equal(apart.linked, false);
  assert.deepEqual(apart.views.left, home);
  assert.equal(apart.views.right?.x, 1400);
});

test("relinking keeps the offset made while unlinked", () => {
  const unlinked = unlinkViews(createLinkedViews(panes, home));
  const nudged = moveView(unlinked, "right", { x: 1040, y: 770, zoom: -2.5, rotation: 4 });
  const relinked = relinkViews(nudged, "left");
  assert.equal(relinked.linked, true);
  assert.deepEqual(relinked.offsets.left, noOffset);
  assert.deepEqual(relinked.offsets.right, { x: 40, y: -30, zoom: 0.5, rotation: 4 });
  assert.deepEqual(relinked.views, nudged.views);
});

test("a linked move from either pane carries the offset along", () => {
  const nudged = moveView(unlinkViews(createLinkedViews(panes, home)), "right", {
    x: 1040,
    y: 770,
    zoom: -2.5,
    rotation: 4,
  });
  const relinked = relinkViews(nudged, "left");
  const fromLeft = moveView(relinked, "left", { x: 2000, y: 2000, zoom: 0, rotation: 90 });
  assert.deepEqual(fromLeft.views.right, { x: 2040, y: 1970, zoom: 0.5, rotation: 94 });
  const fromRight = moveView(relinked, "right", { x: 3040, y: 2970, zoom: 1.5, rotation: 14 });
  assert.deepEqual(fromRight.views.left, { x: 3000, y: 3000, zoom: 1, rotation: 10 });
  assert.deepEqual(fromRight.views.right, { x: 3040, y: 2970, zoom: 1.5, rotation: 14 });
});

test("the offset survives unlinking and relinking more than once without drifting", () => {
  let state = createLinkedViews(panes, home);
  state = moveView(unlinkViews(state), "right", { ...home, x: 1100 });
  state = relinkViews(state, "left");
  state = moveView(state, "left", { ...home, x: 1500, zoom: -1 });
  state = toggleLinked(state, "left");
  state = toggleLinked(state, "left");
  assert.deepEqual(state.offsets.right, { x: 100, y: 0, zoom: 0, rotation: 0 });
  assert.equal(state.views.right?.x, 1600);
});

test("a pane at home has no offset to keep", () => {
  const state = unlinkViews(createLinkedViews(panes, null));
  const left = moveView(state, "left", home);
  const relinked = relinkViews(left, "left");
  assert.deepEqual(relinked.offsets.right, noOffset);
  assert.equal(relinked.views.right, null);
});

test("aligning drops the offset and puts every pane on the reference", () => {
  const apart = moveView(unlinkViews(createLinkedViews(panes, home)), "right", {
    ...home,
    x: 1400,
  });
  const aligned = alignViews(apart, "left");
  assert.equal(aligned.linked, true);
  assert.deepEqual(aligned.views.right, home);
  assert.deepEqual(aligned.offsets.right, noOffset);
});

test("three panes keep their own offsets from one shared view", () => {
  const three = ["a", "b", "c"] as const;
  let state: LinkedViews<"a" | "b" | "c"> = unlinkViews(createLinkedViews(three, home));
  state = moveView(state, "b", { ...home, x: 1010 });
  state = moveView(state, "c", { ...home, y: 760 });
  state = relinkViews(state, "a");
  state = moveView(state, "a", { ...home, x: 0, y: 0 });
  assert.deepEqual(
    [state.views.a?.x, state.views.b?.x, state.views.c?.x, state.views.c?.y],
    [0, 10, 0, -40],
  );
});

test("an offset between two views shifts one onto the other", () => {
  const target: LinkedView = { x: 10, y: -5, zoom: 2, rotation: 15 };
  assert.deepEqual(shiftView(home, offsetBetween(home, target)), target);
  assert.equal(shiftView(home, noOffset), home);
});
