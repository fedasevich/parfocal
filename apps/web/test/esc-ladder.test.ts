import assert from "node:assert/strict";
import { test } from "node:test";
import { type EscLayer, type EscState, escLadder, escLayer } from "../src/keys/esc-ladder.ts";

const none: EscState = {
  overlay: false,
  comment: false,
  dragging: false,
  draft: false,
  run: false,
  vertex: false,
  selection: false,
  focusReview: false,
  tool: false,
  panel: false,
};

const everything: EscState = Object.fromEntries(
  Object.keys(none).map((key) => [key, true]),
) as EscState;

const keyOf: Record<EscLayer, keyof EscState> = {
  overlay: "overlay",
  comment: "comment",
  drag: "dragging",
  draft: "draft",
  run: "run",
  vertex: "vertex",
  selection: "selection",
  focus: "focusReview",
  tool: "tool",
  panel: "panel",
};

const order: EscLayer[] = [
  "overlay",
  "comment",
  "drag",
  "draft",
  "run",
  "vertex",
  "selection",
  "focus",
  "tool",
  "panel",
];

test("nothing open peels nothing", () => {
  assert.equal(escLayer(none), null);
});

test("ladder lists the layers in order", () => {
  assert.deepEqual(
    escLadder.map((rung) => rung.layer),
    order,
  );
});

for (const [index, layer] of order.entries()) {
  test(`${layer} alone is peeled`, () => {
    assert.equal(escLayer({ ...none, [keyOf[layer]]: true }), layer);
  });

  test(`${layer} is peeled before every layer below it`, () => {
    const below = Object.fromEntries(order.slice(index + 1).map((l) => [keyOf[l], true]));
    assert.equal(escLayer({ ...none, ...below, [keyOf[layer]]: true }), layer);
  });
}

test("repeated Esc peels every layer once from the top", () => {
  const state = { ...everything };
  const seen: EscLayer[] = [];
  for (let step = 0; step < order.length + 1; step += 1) {
    const layer = escLayer(state);
    if (layer === null) break;
    seen.push(layer);
    state[keyOf[layer]] = false;
  }
  assert.deepEqual(seen, order);
  assert.equal(escLayer(state), null);
});
