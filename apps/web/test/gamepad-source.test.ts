import assert from "node:assert/strict";
import { test } from "node:test";
import { createCameraInput } from "../src/devices/camera-input.ts";
import type { LegendContext } from "../src/devices/device-legend.ts";
import {
  bindGamepad,
  createGamepadReader,
  type PadSnapshot,
} from "../src/devices/gamepad-source.ts";
import type { Intent } from "../src/devices/intents.ts";

type Press = Record<number, boolean>;

const pad = (
  options: {
    axes?: number[];
    left?: number;
    right?: number;
    pressed?: Press;
    mapping?: string;
  } = {},
): PadSnapshot => {
  const buttons = Array.from({ length: 17 }, (_, index) => {
    const value = index === 6 ? (options.left ?? 0) : index === 7 ? (options.right ?? 0) : 0;
    const pressed = options.pressed?.[index] ?? value > 0.5;
    return { pressed, value: pressed && value === 0 ? 1 : value };
  });
  return { mapping: options.mapping ?? "standard", axes: options.axes ?? [0, 0, 0, 0], buttons };
};

const harness = (context: LegendContext = "review", speed = 60, deadZone = 10) => {
  const intents: Intent[] = [];
  const pans: number[][] = [];
  const zooms: number[] = [];
  const input = createCameraInput({
    device: () => "gamepad",
    context: () => context,
    calibration: () => ({ deadZone, speed }),
    camera: {
      panBy: (dx, dy) => pans.push([dx, dy]),
      zoomBy: (octaves) => zooms.push(octaves),
    },
    onIntent: (intent) => intents.push(intent),
  });
  const reader = createGamepadReader();
  const feed = (snapshot: PadSnapshot, ms = 16) => {
    for (const raw of reader.read(snapshot)) input.push(raw, ms);
  };
  return { intents, pans, zooms, feed, reader, input };
};

const kinds = (intents: Intent[]) => intents.map((intent) => intent.kind);

test("left stick pans by deflection and ignores the dead zone", () => {
  const rig = harness();
  rig.feed(pad({ axes: [0.05, -0.05, 0, 0] }));
  assert.deepEqual(rig.pans, []);
  rig.feed(pad({ axes: [-1, 0, 0, 0] }));
  rig.feed(pad({ axes: [-0.5, 0, 0, 0] }));
  const [full, half] = rig.pans.map((pan) => pan[0] ?? 0);
  assert.ok((full ?? 0) > (half ?? 0) * 1.9);
  assert.ok((full ?? 0) > 0);
});

test("stick up pans up and right pans right", () => {
  const rig = harness();
  rig.feed(pad({ axes: [0, -1, 0, 0] }));
  assert.ok(rig.pans[0]![1]! > 0);
  const other = harness();
  other.feed(pad({ axes: [1, 0, 0, 0] }));
  assert.ok(other.pans[0]![0]! < 0);
});

test("per-device speed scales the pan", () => {
  const slow = harness("review", 30);
  const fast = harness("review", 120);
  slow.feed(pad({ axes: [0, -1, 0, 0] }));
  fast.feed(pad({ axes: [0, -1, 0, 0] }));
  assert.ok(Math.abs(fast.pans[0]![1]! / slow.pans[0]![1]! - 4) < 1e-9);
});

test("triggers zoom in and out", () => {
  const rig = harness();
  rig.feed(pad({ right: 1 }));
  rig.feed(pad({ left: 1 }));
  assert.ok(rig.zooms[0]! > 0);
  assert.ok(rig.zooms[1]! < 0);
  rig.feed(pad({ right: 0.05 }));
  assert.equal(rig.zooms.length, 2);
});

test("buttons map to review decisions once per press", () => {
  const rig = harness("review");
  rig.feed(pad({ pressed: { 0: true } }));
  rig.feed(pad({ pressed: { 0: true } }));
  rig.feed(pad({ pressed: { 1: true } }));
  rig.feed(pad({ pressed: { 2: true } }));
  assert.deepEqual(kinds(rig.intents), ["keep", "nextCell", "notACell"]);
});

test("d-pad sets the cell type", () => {
  const rig = harness("review");
  const types = [12, 15, 13, 14].map((index) => {
    rig.intents.length = 0;
    rig.feed(pad({ pressed: { [index]: true } }));
    rig.feed(pad());
    const [intent] = rig.intents;
    return intent?.kind === "setType" ? intent.type : 0;
  });
  assert.deepEqual(types, [1, 2, 3, 4]);
});

test("shoulders step presets and start goes to the next area", () => {
  const rig = harness("read");
  rig.feed(pad({ pressed: { 5: true } }));
  rig.feed(pad({ pressed: { 4: true } }));
  rig.feed(pad({ pressed: { 9: true } }));
  assert.deepEqual(rig.intents, [
    { kind: "presetStep", step: 1 },
    { kind: "presetStep", step: -1 },
    { kind: "nextArea" },
  ]);
});

test("holding select peeks and releasing ends it", () => {
  const rig = harness("review");
  rig.feed(pad({ pressed: { 8: true } }));
  rig.feed(pad({ pressed: { 8: true } }));
  rig.feed(pad());
  assert.deepEqual(rig.intents, [
    { kind: "peek", held: true },
    { kind: "peek", held: false },
  ]);
});

test("reset releases a held select", () => {
  const rig = harness();
  rig.feed(pad({ pressed: { 8: true } }));
  assert.deepEqual(rig.reader.reset(), [{ kind: "button", name: "select", down: false }]);
  assert.deepEqual(rig.reader.reset(), []);
});

test("the polling loop ignores non standard pads and blurred tabs", () => {
  const intents: Intent[] = [];
  const input = createCameraInput({
    device: () => "gamepad",
    context: () => "review",
    camera: { panBy: () => undefined, zoomBy: () => undefined },
    onIntent: (intent) => intents.push(intent),
  });
  let queued: (() => void) | null = null;
  let focused = true;
  let pads: (PadSnapshot | null)[] = [pad({ mapping: "", pressed: { 0: true } })];
  const stop = bindGamepad(input, {
    getPads: () => pads,
    frames: {
      request: (cb) => {
        queued = cb;
        return 1;
      },
      cancel: () => {
        queued = null;
      },
    },
    now: () => 0,
    focused: () => focused,
  });
  queued!();
  assert.deepEqual(intents, []);
  pads = [null, pad({ pressed: { 0: true } })];
  focused = false;
  queued!();
  assert.deepEqual(intents, []);
  focused = true;
  queued!();
  assert.deepEqual(kinds(intents), ["keep"]);
  stop();
  assert.equal(queued, null);
});
