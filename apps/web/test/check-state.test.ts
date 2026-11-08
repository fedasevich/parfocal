import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CheckState,
  canConfirm,
  checkProgressOf,
  confirmAction,
  confirmBindings,
  confirmedCopy,
  confirms,
  progressLine,
} from "../src/annotations/check-state.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { idleKeys, step } from "../src/keys/registry.ts";

const ai = (check: CheckState) => ({ kind: "ai" as const, check, origin: "ai" });
const human = { kind: "human" as const, check: "unchecked" as const, origin: "human" };

test("D confirms the selected AI object on annotate screens", () => {
  assert.deepEqual(confirmBindings(), [{ action: confirmAction, keys: ["D"] }]);
  const pressed = step(confirmBindings(), idleKeys, {
    type: "down",
    key: "D",
    at: 0,
    typing: false,
  });
  assert.ok(pressed.fired.some(confirms));
});

test("the confirm key is not bound outside the annotate scope", () => {
  const review = keyRegistry.bindings({ scopes: ["viewer", "review"] });
  assert.ok(!review.some((binding) => binding.action === confirmAction));
  const annotate = keyRegistry.bindings({ scopes: ["viewer", "review", "annotate"] });
  const agree = annotate.find((binding) => binding.action === "dagree");
  assert.deepEqual(agree?.keys, ["K"]);
});

test("only an unchecked AI object can be confirmed", () => {
  assert.equal(canConfirm(ai("unchecked")), true);
  assert.equal(canConfirm(ai("confirmed")), false);
  assert.equal(canConfirm(ai("edited")), false);
  assert.equal(canConfirm(human), false);
  assert.equal(canConfirm(undefined), false);
});

test("a confirmed copy keeps the object and takes the origin ai-confirmed", () => {
  const object = { ...ai("unchecked"), id: "O25", path: "M0,0L9,0L9,9Z" };
  const copy = confirmedCopy(object);
  assert.deepEqual(copy, { ...object, origin: "ai-confirmed", check: "confirmed" });
  assert.equal(object.origin, "ai");
});

test("the progress line counts confirmed, edited and deleted objects as checked", () => {
  const objects = [
    ai("unchecked"),
    ai("unchecked"),
    ai("confirmed"),
    ai("edited"),
    ai("deleted"),
    human,
  ];
  const progress = checkProgressOf(objects);
  assert.deepEqual(progress, {
    scope: 5,
    checked: 3,
    unchecked: 2,
    confirmed: 1,
    edited: 1,
    deleted: 1,
  });
  assert.equal(progressLine(progress), "3 of 5 checked");
  assert.equal(progressLine(checkProgressOf([])), "0 of 0 checked");
});
