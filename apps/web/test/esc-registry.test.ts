import assert from "node:assert/strict";
import { test } from "node:test";
import { escLayer } from "../src/keys/esc-ladder.ts";
import { createEscRegistry } from "../src/keys/esc-registry.ts";

const flag = (initial: boolean) => {
  const box = { on: initial, peeled: 0 };
  return {
    box,
    rung: {
      open: () => box.on,
      peel: () => {
        box.peeled += 1;
        box.on = false;
      },
    },
  };
};

test("the registry reports a layer as open when any of its rungs is open", () => {
  const registry = createEscRegistry();
  const first = flag(false);
  const second = flag(true);
  registry.add("draft", first.rung);
  registry.add("draft", second.rung);
  assert.equal(registry.state().draft, true);
  assert.equal(registry.state().tool, false);
});

test("peeling goes one rung per call in the ladder's order", () => {
  const registry = createEscRegistry();
  const tool = flag(true);
  const draft = flag(true);
  const comment = flag(true);
  registry.add("tool", tool.rung);
  registry.add("draft", draft.rung);
  registry.add("comment", comment.rung);
  const order: (string | null)[] = [];
  for (let press = 0; press < 4; press += 1) {
    const layer = escLayer(registry.state());
    order.push(layer);
    if (layer !== null) registry.peel(layer);
  }
  assert.deepEqual(order, ["comment", "draft", "tool", null]);
  assert.equal(comment.box.peeled + draft.box.peeled + tool.box.peeled, 3);
});

test("a removed rung is no longer asked", () => {
  const registry = createEscRegistry();
  const draft = flag(true);
  const remove = registry.add("draft", draft.rung);
  remove();
  assert.equal(registry.state().draft, false);
  assert.equal(registry.peel("draft"), false);
});
