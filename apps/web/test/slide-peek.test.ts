import assert from "node:assert/strict";
import { test } from "node:test";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { idleKeys, step, tapMs } from "../src/keys/registry.ts";
import { cameraFromSearch } from "../src/screens/review/camera-search.ts";
import { overviewSize } from "../src/screens/review/slide-geometry.ts";
import { peekGoScale, peekKeyStep, peekSpot } from "../src/screens/viewer-tools/peek-model.ts";

type Peek = "closed" | "held" | "latched";

function run(inputs: { type: "down" | "up"; key: string; code: string; at: number }[]): Peek[] {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"], only: ["peek", "esc"] });
  let keys = idleKeys;
  let peek: Peek = "closed";
  let closing = false;
  const seen: Peek[] = [];
  for (const input of inputs) {
    const result = step(bindings, keys, input);
    keys = result.state;
    for (const fired of result.fired) {
      if (fired.action === "esc" && peek === "closed") continue;
      const next = peekKeyStep(peek !== "closed", closing, fired);
      closing = next.closing;
      if (next.effect === "hold") peek = "held";
      else if (next.effect === "latch") peek = "latched";
      else if (next.effect === "close") peek = "closed";
    }
    seen.push(peek);
  }
  return seen;
}

const z = { key: "z", code: "KeyZ" };
const esc = { key: "Escape", code: "Escape" };

test("holding Z shows the whole slide and releasing returns", () => {
  assert.deepEqual(
    run([
      { type: "down", ...z, at: 0 },
      { type: "up", ...z, at: tapMs + 200 },
    ]),
    ["held", "closed"],
  );
});

test("a tap under 350 ms latches the peek until Z is pressed again", () => {
  assert.equal(tapMs, 350);
  assert.deepEqual(
    run([
      { type: "down", ...z, at: 0 },
      { type: "up", ...z, at: 120 },
      { type: "down", ...z, at: 2000 },
      { type: "up", ...z, at: 2080 },
    ]),
    ["held", "latched", "closed", "closed"],
  );
});

test("a long press on a latched peek closes it and the release keeps it closed", () => {
  assert.deepEqual(
    run([
      { type: "down", ...z, at: 0 },
      { type: "up", ...z, at: 100 },
      { type: "down", ...z, at: 1000 },
      { type: "up", ...z, at: 1900 },
    ]),
    ["held", "latched", "closed", "closed"],
  );
});

test("Esc closes a latched peek", () => {
  assert.deepEqual(
    run([
      { type: "down", ...z, at: 0 },
      { type: "up", ...z, at: 100 },
      { type: "down", ...esc, at: 1000 },
    ]),
    ["held", "latched", "closed"],
  );
});

test("Esc does nothing while the peek is closed", () => {
  assert.deepEqual(peekKeyStep(false, false, { action: "esc", phase: "press" }), {
    closing: false,
    effect: null,
  });
});

test("the peek is a hold action on Z in the viewer key registry", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"], only: ["peek"] });
  assert.deepEqual(
    bindings.map((binding) => [binding.action, binding.keys, binding.hold]),
    [["peek", ["Z"], true]],
  );
});

test("a click on the whole slide goes to that place on the whole view", () => {
  const point: [number, number] = [700, 481];
  const spot = peekSpot(point);
  assert.equal(spot.object, null);
  assert.deepEqual(cameraFromSearch("overview", spot), {
    x: 700,
    y: 481,
    scale: peekGoScale,
  });
  assert.equal(spot.x, 0.5);
  assert.equal(spot.y, 0.25);
  assert.ok(point[0] < overviewSize.width && point[1] < overviewSize.height);
});
