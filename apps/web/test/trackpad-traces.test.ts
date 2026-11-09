import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyWheel,
  defaultCameraProfile,
  freshWheelClassifier,
  isTwoFingerClick,
  safariPinchOctaves,
  type WheelClassifier,
  type WheelDevice,
} from "@parfocal/viewer-engine";
import { type Intent, mapInput, type RawInput } from "../src/devices/intents.ts";

interface WheelStep {
  readonly type: "wheel";
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly expect: "pan" | "zoom";
  readonly panSign?: readonly [number, number];
  readonly zoomSign?: number;
  readonly animate?: boolean;
}

interface PointerStep {
  readonly type: "pointer";
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly pointerType: string;
  readonly expect: "negativePoint" | "none";
}

interface PinchStep {
  readonly type: "safariPinch";
  readonly previousScale: number;
  readonly scale: number;
  readonly expect: "zoom" | "none";
}

interface Fixture {
  readonly origin: "synthetic" | "recorded";
  readonly todo: string;
  readonly label: string;
  readonly wheelDevice: WheelDevice;
  readonly steps: readonly (WheelStep | PointerStep | PinchStep)[];
}

const directory = fileURLToPath(new URL("./fixtures/trackpad", import.meta.url));

const fixtures = readdirSync(directory)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => ({
    file,
    fixture: JSON.parse(readFileSync(`${directory}/${file}`, "utf8")) as Fixture,
  }));

function intentsFor(
  deviceState: WheelClassifier,
  step: WheelStep | PointerStep | PinchStep,
): { state: WheelClassifier; intents: Intent[] } {
  if (step.type === "wheel") {
    const state = classifyWheel(deviceState, step);
    const raw: RawInput = { kind: "wheel", mode: "auto", wheelDevice: state.device, input: step };
    return { state, intents: mapInput(state.device, "annotate", raw) };
  }
  const raw: RawInput =
    step.type === "pointer" ? { ...step, kind: "pointer" } : { ...step, kind: "safariPinch" };
  return { state: deviceState, intents: mapInput("trackpad", "annotate", raw) };
}

test("there are traces for macOS and Windows trackpads, Safari and a mouse", () => {
  assert.equal(fixtures.length, 4);
  for (const { file, fixture } of fixtures) {
    assert.equal(file.includes(".synthetic."), fixture.origin === "synthetic", file);
    if (fixture.origin === "synthetic") assert.match(fixture.todo, /^TODO/, file);
  }
});

for (const { file, fixture } of fixtures) {
  test(`${file} replays to the right intents`, () => {
    let state = freshWheelClassifier;
    fixture.steps.forEach((step, index) => {
      const result = intentsFor(state, step);
      state = result.state;
      const where = `${fixture.label}, step ${index}`;
      if (step.type === "wheel") {
        assert.equal(result.intents.length, 1, where);
        const [intent] = result.intents as [Intent];
        assert.equal(intent.kind, step.expect, where);
        if (intent.kind === "pan" && step.panSign) {
          assert.equal(Math.sign(intent.dx), step.panSign[0], where);
          assert.equal(Math.sign(intent.dy), step.panSign[1], where);
        }
        if (intent.kind === "zoom") {
          assert.equal(Math.sign(intent.octaves), step.zoomSign, where);
          assert.equal(intent.animate, step.animate, where);
          assert.ok(Math.abs(intent.octaves) <= defaultCameraProfile.maxOctavesPerEvent, where);
        }
        return;
      }
      const kinds = result.intents.map((intent) => intent.kind);
      assert.deepEqual(kinds, step.expect === "none" ? [] : [step.expect], where);
    });
    assert.equal(state.device, fixture.wheelDevice);
  });
}

test("a two-finger scroll pans in both axes and does not zoom", () => {
  const trace = fixtures.find(({ file }) => file.startsWith("macos-chrome"))?.fixture;
  assert.ok(trace);
  const pans = trace.steps.filter((step) => step.type === "wheel" && !step.ctrlKey);
  assert.ok(pans.some((step) => step.type === "wheel" && step.deltaX !== 0));
  assert.ok(pans.every((step) => step.type === "wheel" && step.expect === "pan"));
});

test("only a secondary press or Ctrl+click of a mouse-type pointer is a two-finger click", () => {
  assert.equal(isTwoFingerClick({ button: 2, ctrlKey: false, pointerType: "mouse" }), true);
  assert.equal(isTwoFingerClick({ button: 0, ctrlKey: true, pointerType: "mouse" }), true);
  assert.equal(isTwoFingerClick({ button: 0, ctrlKey: false, pointerType: "mouse" }), false);
  assert.equal(isTwoFingerClick({ button: 1, ctrlKey: false, pointerType: "mouse" }), false);
  assert.equal(isTwoFingerClick({ button: 2, ctrlKey: false, pointerType: "touch" }), false);
});

test("a two-finger click only removes a point while annotating", () => {
  const raw: RawInput = { kind: "pointer", button: 2, ctrlKey: false, pointerType: "mouse" };
  assert.deepEqual(mapInput("trackpad", "read", raw), []);
  assert.deepEqual(mapInput("trackpad", "review", raw), []);
  assert.deepEqual(mapInput("pen", "annotate", raw), []);
  assert.deepEqual(mapInput("trackpad", "annotate", raw), [{ kind: "negativePoint" }]);
});

test("Safari pinch is the log2 of the scale step capped at half an octave", () => {
  assert.equal(safariPinchOctaves(1, 2), 0.5);
  assert.equal(safariPinchOctaves(2, 1), -0.5);
  assert.ok(Math.abs(safariPinchOctaves(1, 1.1) - Math.log2(1.1)) < 1e-12);
  assert.equal(safariPinchOctaves(0, 1), 0);
  assert.equal(safariPinchOctaves(1, Number.NaN), 0);
});
