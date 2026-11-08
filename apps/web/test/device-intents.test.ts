import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultCameraProfile, type WheelMode, wheelIntent } from "@parfocal/viewer-engine";
import { calibrationDefaults } from "../src/devices/calibration.ts";
import { type LegendContext, legendDevices } from "../src/devices/device-legend.ts";
import {
  calibratedProfile,
  type Intent,
  mapInput,
  type RawInput,
  type WheelRaw,
} from "../src/devices/intents.ts";

type Zoom = Extract<Intent, { kind: "zoom" }>;
type Pan = Extract<Intent, { kind: "pan" }>;

const key = (name: string, extra: { shift?: boolean; alt?: boolean } = {}): RawInput => ({
  kind: "key",
  key: name,
  ...extra,
});

const button = (name: string): RawInput => ({ kind: "button", name });
const gesture = (name: string): RawInput => ({ kind: "gesture", name });
const axes = (x: number, y: number, zoom: number): RawInput => ({ kind: "axes", x, y, zoom });

const wheelRaw: WheelRaw = {
  deltaX: 0,
  deltaY: -120,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

const kinds = (intents: Intent[]) => intents.map((intent) => intent.kind);

test("every device in the kit device matrix yields an intent", () => {
  assert.equal(legendDevices.length, 7);
  const probes: Record<string, [LegendContext, RawInput]> = {
    mouse: ["read", { kind: "wheel", mode: "auto", wheelDevice: "mouse", input: wheelRaw }],
    trackpad: ["read", { kind: "wheel", mode: "auto", wheelDevice: "trackpad", input: wheelRaw }],
    spacemouse: ["review", button("left")],
    gamepad: ["review", button("a")],
    pen: ["review", gesture("swipe-sheet")],
    keyboard: ["review", key("j")],
    footswitch: ["review", key("J")],
  };
  for (const device of legendDevices) {
    const [context, raw] = probes[device] as [LegendContext, RawInput];
    assert.ok(mapInput(device, context, raw).length > 0, device);
  }
});

test("wheel input matches the engine intent at the default calibration", () => {
  for (const mode of ["auto", "zoom", "pan"] as WheelMode[]) {
    for (const wheelDevice of ["mouse", "trackpad"] as const) {
      const input = { ...wheelRaw, deltaY: wheelDevice === "mouse" ? -100 : -3.5 };
      const expected = wheelIntent(mode, wheelDevice, input, defaultCameraProfile);
      const actual = mapInput(wheelDevice, "read", { kind: "wheel", mode, wheelDevice, input });
      if (expected.kind === "zoom") {
        assert.deepEqual(actual, expected.octaves === 0 ? [] : [expected]);
      } else {
        assert.deepEqual(actual, [
          { kind: "pan", dx: expected.dx, dy: expected.dy, unit: "pixels" },
        ]);
      }
    }
  }
});

test("trackpad pinch matches the engine pinch zoom without easing", () => {
  const input = { ...wheelRaw, ctrlKey: true, deltaY: -2.5 };
  const expected = wheelIntent("auto", "trackpad", input, defaultCameraProfile);
  assert.equal(expected.kind, "zoom");
  const [actual] = mapInput("trackpad", "read", {
    kind: "wheel",
    mode: "auto",
    wheelDevice: "trackpad",
    input,
  });
  assert.deepEqual(actual, { ...expected, animate: false });
});

test("the default calibration leaves the camera profile untouched", () => {
  assert.equal(calibratedProfile(defaultCameraProfile, calibrationDefaults), defaultCameraProfile);
});

test("wheel speed scales zoom and pan", () => {
  const fast = { ...calibrationDefaults, speed: 120 };
  const zoomInput = { kind: "wheel", mode: "zoom", wheelDevice: "mouse", input: wheelRaw } as const;
  const [base] = mapInput("mouse", "read", zoomInput) as Zoom[];
  const [scaled] = mapInput("mouse", "read", zoomInput, { calibration: fast }) as Zoom[];
  assert.ok(Math.abs((scaled as Zoom).octaves) > Math.abs((base as Zoom).octaves));
  const panInput = {
    kind: "wheel",
    mode: "pan",
    wheelDevice: "trackpad",
    input: { ...wheelRaw, deltaX: 4, deltaY: 6 },
  } as const;
  const [slow] = mapInput("trackpad", "read", panInput) as Pan[];
  const [quick] = mapInput("trackpad", "read", panInput, { calibration: fast }) as Pan[];
  assert.equal((quick as Pan).dx, (slow as Pan).dx * 2);
});

test("keyboard maps pan, zoom, presets, areas and peek in read", () => {
  assert.deepEqual(mapInput("keyboard", "read", key("ArrowLeft")), [
    { kind: "pan", dx: 1, dy: 0, unit: "rate" },
  ]);
  assert.deepEqual(mapInput("keyboard", "read", key("ArrowUp", { shift: true })), [
    { kind: "pan", dx: 0, dy: 3, unit: "rate" },
  ]);
  assert.equal(mapInput("keyboard", "read", key("+"))[0]?.kind, "zoom");
  assert.deepEqual(mapInput("keyboard", "read", key("3", { alt: true })), [
    { kind: "preset", digit: 3 },
  ]);
  assert.deepEqual(kinds(mapInput("keyboard", "read", key("]"))), ["nextArea"]);
  assert.deepEqual(mapInput("keyboard", "read", key("z")), [{ kind: "peek", held: true }]);
  assert.deepEqual(mapInput("keyboard", "read", key("j")), []);
});

test("mouse and trackpad share the keyboard review loop", () => {
  for (const device of ["mouse", "trackpad"] as const) {
    assert.deepEqual(kinds(mapInput(device, "review", key("j"))), ["nextCell"]);
    assert.deepEqual(kinds(mapInput(device, "review", key("k"))), ["keep"]);
  }
});

test("keyboard maps the review loop", () => {
  assert.deepEqual(kinds(mapInput("keyboard", "review", key("j"))), ["nextCell"]);
  assert.deepEqual(kinds(mapInput("keyboard", "review", key("J", { shift: true }))), [
    "previousCell",
  ]);
  assert.deepEqual(kinds(mapInput("keyboard", "review", key("k"))), ["keep"]);
  assert.deepEqual(kinds(mapInput("keyboard", "review", key("x"))), ["notACell"]);
  assert.deepEqual(mapInput("keyboard", "review", key("4")), [{ kind: "setType", type: 4 }]);
  assert.deepEqual(mapInput("keyboard", "review", key("5")), []);
});

test("spacemouse tilt pans with dead zone and speed, pulling fully peeks", () => {
  assert.deepEqual(mapInput("spacemouse", "read", axes(0.05, -0.05, 0)), []);
  assert.deepEqual(mapInput("spacemouse", "read", axes(1, 0, 0)), [
    { kind: "pan", dx: 1, dy: 0, unit: "rate" },
  ]);
  const [fast] = mapInput("spacemouse", "read", axes(1, 0, 0), {
    calibration: { deadZone: 10, speed: 120 },
  }) as Pan[];
  assert.equal((fast as Pan).dx, 2);
  assert.deepEqual(kinds(mapInput("spacemouse", "read", axes(0, 0, -1))), ["zoom", "peek"]);
  assert.deepEqual(kinds(mapInput("spacemouse", "annotate", axes(0, 0, -1))), ["zoom"]);
});

test("spacemouse buttons and keyboard retype", () => {
  assert.deepEqual(kinds(mapInput("spacemouse", "review", button("left"))), ["nextCell"]);
  assert.deepEqual(kinds(mapInput("spacemouse", "review", button("right"))), ["keep"]);
  assert.deepEqual(mapInput("spacemouse", "read", button("side-next")), [
    { kind: "presetStep", step: 1 },
  ]);
  assert.deepEqual(mapInput("spacemouse", "review", key("2")), [{ kind: "setType", type: 2 }]);
  assert.deepEqual(mapInput("spacemouse", "review", key("j")), []);
});

test("gamepad sticks, triggers and buttons", () => {
  assert.deepEqual(mapInput("gamepad", "read", axes(0.05, 0, 0)), []);
  assert.deepEqual(kinds(mapInput("gamepad", "read", axes(0, 1, 1))), ["pan", "zoom"]);
  assert.deepEqual(kinds(mapInput("gamepad", "read", axes(0, 0, -1))), ["zoom"]);
  assert.deepEqual(kinds(mapInput("gamepad", "review", button("b"))), ["nextCell"]);
  assert.deepEqual(kinds(mapInput("gamepad", "review", button("a"))), ["keep"]);
  assert.deepEqual(kinds(mapInput("gamepad", "review", button("x"))), ["notACell"]);
  assert.deepEqual(mapInput("gamepad", "review", button("dpad-left")), [
    { kind: "setType", type: 4 },
  ]);
  assert.deepEqual(kinds(mapInput("gamepad", "read", button("start"))), ["nextArea"]);
  assert.deepEqual(mapInput("gamepad", "read", button("shoulder-left")), [
    { kind: "presetStep", step: -1 },
  ]);
  assert.deepEqual(mapInput("gamepad", "read", button("a")), []);
});

test("pen gestures", () => {
  assert.deepEqual(mapInput("pen", "read", gesture("double-tap")), [
    { kind: "magnification", value: 40 },
  ]);
  assert.deepEqual(mapInput("pen", "read", gesture("two-finger-double-tap")), [
    { kind: "peek", held: true },
  ]);
  assert.deepEqual(kinds(mapInput("pen", "review", gesture("swipe-sheet"))), ["nextCell"]);
  assert.deepEqual(kinds(mapInput("pen", "review", gesture("keep-button"))), ["keep"]);
  assert.deepEqual(kinds(mapInput("pen", "review", gesture("not-a-cell-button"))), ["notACell"]);
  assert.deepEqual(mapInput("pen", "review", gesture("type-button-3")), [
    { kind: "setType", type: 3 },
  ]);
  assert.deepEqual(mapInput("pen", "annotate", gesture("swipe-sheet")), []);
});

test("footswitch follows its configured key and the area keys", () => {
  assert.deepEqual(kinds(mapInput("footswitch", "review", key("J"))), ["nextCell"]);
  assert.deepEqual(kinds(mapInput("footswitch", "review", key("F"), { footswitchKey: "F" })), [
    "nextCell",
  ]);
  assert.deepEqual(mapInput("footswitch", "review", key("J"), { footswitchKey: "F" }), []);
  assert.deepEqual(kinds(mapInput("footswitch", "review", key("J", { shift: true }))), [
    "previousCell",
  ]);
  assert.deepEqual(kinds(mapInput("footswitch", "review", key("k"))), ["keep"]);
  assert.deepEqual(kinds(mapInput("footswitch", "read", key("]"))), ["nextArea"]);
  assert.deepEqual(kinds(mapInput("footswitch", "read", key("["))), ["previousArea"]);
  assert.deepEqual(mapInput("footswitch", "annotate", key("]")), []);
});

test("devices ignore inputs they do not produce", () => {
  const wheel: RawInput = { kind: "wheel", mode: "auto", wheelDevice: "mouse", input: wheelRaw };
  assert.deepEqual(mapInput("gamepad", "read", wheel), []);
  assert.deepEqual(mapInput("mouse", "read", axes(1, 1, 1)), []);
  assert.deepEqual(mapInput("keyboard", "read", gesture("swipe-sheet")), []);
});
