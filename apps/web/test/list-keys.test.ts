import assert from "node:assert/strict";
import { test } from "node:test";
import { listMove } from "../src/screens/my-work/list-keys.ts";

const rows = ["a", "b", "c"];

test("arrows and J and K step through the rows and stop at the ends", () => {
  assert.deepEqual(listMove({ key: "ArrowDown" }, rows, "a"), { kind: "select", sel: "b" });
  assert.deepEqual(listMove({ key: "j" }, rows, "b"), { kind: "select", sel: "c" });
  assert.deepEqual(listMove({ key: "J" }, rows, "c"), { kind: "select", sel: "c" });
  assert.deepEqual(listMove({ key: "k" }, rows, "b"), { kind: "select", sel: "a" });
  assert.deepEqual(listMove({ key: "ArrowUp" }, rows, "a"), { kind: "select", sel: "a" });
});

test("with nothing selected, down picks the first row and up the last", () => {
  assert.deepEqual(listMove({ key: "j" }, rows, undefined), { kind: "select", sel: "a" });
  assert.deepEqual(listMove({ key: "ArrowUp" }, rows, undefined), { kind: "select", sel: "c" });
  assert.deepEqual(listMove({ key: "ArrowDown" }, rows, "gone"), { kind: "select", sel: "a" });
  assert.equal(listMove({ key: "j" }, [], undefined), undefined);
});

test("Enter opens and Esc clears only when a row is selected", () => {
  assert.deepEqual(listMove({ key: "Enter" }, rows, "b"), { kind: "open" });
  assert.equal(listMove({ key: "Enter" }, rows, undefined), undefined);
  assert.deepEqual(listMove({ key: "Escape" }, rows, "b"), { kind: "clear" });
  assert.equal(listMove({ key: "Escape" }, rows, undefined), undefined);
});

test("modifier chords and other keys are left alone", () => {
  assert.equal(listMove({ key: "k", metaKey: true }, rows, "a"), undefined);
  assert.equal(listMove({ key: "j", ctrlKey: true }, rows, "a"), undefined);
  assert.equal(listMove({ key: "ArrowDown", altKey: true }, rows, "a"), undefined);
  assert.equal(listMove({ key: "x" }, rows, "a"), undefined);
});
