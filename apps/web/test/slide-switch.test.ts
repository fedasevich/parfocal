import assert from "node:assert/strict";
import { test } from "node:test";
import {
  forgetSlideCameras,
  recallSlideCamera,
  rememberSlideCamera,
  stepSlideId,
} from "../src/screens/review/slide-switch.ts";

const ids = ["a1", "a2", "b1"];

test("Q and E step to the neighbours and stop at the ends", () => {
  assert.equal(stepSlideId(ids, "a2", 1), "b1");
  assert.equal(stepSlideId(ids, "a2", -1), "a1");
  assert.equal(stepSlideId(ids, "a1", -1), undefined);
  assert.equal(stepSlideId(ids, "b1", 1), undefined);
});

test("stepping from a slide outside the list does nothing", () => {
  assert.equal(stepSlideId(ids, "elsewhere", 1), undefined);
});

test("each slide keeps its own camera", () => {
  forgetSlideCameras();
  rememberSlideCamera("a1", { x: 0.2, y: 0.3, z: 4 });
  rememberSlideCamera("a2", { x: 0.7, y: 0.1, z: 1.5 });
  assert.deepEqual(recallSlideCamera("a1"), { x: 0.2, y: 0.3, z: 4 });
  assert.deepEqual(recallSlideCamera("a2"), { x: 0.7, y: 0.1, z: 1.5 });
  assert.deepEqual(recallSlideCamera("b1"), {});
});

test("a camera that is not complete is not remembered", () => {
  forgetSlideCameras();
  rememberSlideCamera("a1", { x: 0.2 });
  assert.deepEqual(recallSlideCamera("a1"), {});
});

test("a later camera replaces the earlier one for the same slide", () => {
  forgetSlideCameras();
  rememberSlideCamera("a1", { x: 0.2, y: 0.3, z: 4 });
  rememberSlideCamera("a1", { x: 0.5, y: 0.5, z: 2 });
  assert.deepEqual(recallSlideCamera("a1"), { x: 0.5, y: 0.5, z: 2 });
});
