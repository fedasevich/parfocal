import assert from "node:assert/strict";
import { test } from "node:test";
import type { LegendContext, LegendDevice } from "../src/devices/device-legend.ts";
import type { Intent } from "../src/devices/intents.ts";
import { bindTrackpadListeners } from "../src/devices/trackpad-listeners.ts";
import { fixtureFromTrace } from "../src/screens/input-traces/fixture.ts";
import type { InputTrace } from "../src/screens/input-traces/trace-format.ts";

class FakeSurface extends EventTarget {
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 200, height: 100 };
  }
}

function dispatch(surface: EventTarget, type: string, fields: Record<string, unknown>) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  surface.dispatchEvent(event);
  return event;
}

function setup(device: LegendDevice, context: LegendContext) {
  const surface = new FakeSurface();
  const intents: Intent[] = [];
  const stop = bindTrackpadListeners(surface as unknown as HTMLElement, {
    device: () => device,
    context: () => context,
    onIntent: (intent) => intents.push(intent),
  });
  return { surface, intents, stop };
}

const press = (button: number, ctrlKey = false, pointerType = "mouse") => ({
  button,
  ctrlKey,
  pointerType,
  clientX: 5,
  clientY: 6,
});

test("a secondary press on a trackpad while annotating is a negative point", () => {
  const { surface, intents } = setup("trackpad", "annotate");
  dispatch(surface, "pointerdown", press(2));
  assert.deepEqual(intents, [{ kind: "negativePoint" }]);
});

test("Ctrl and a primary press is also a negative point", () => {
  const { surface, intents } = setup("trackpad", "annotate");
  dispatch(surface, "pointerdown", press(0, true));
  assert.deepEqual(intents, [{ kind: "negativePoint" }]);
});

test("a plain press, a touch press and a press outside annotating give no intent", () => {
  const annotating = setup("trackpad", "annotate");
  dispatch(annotating.surface, "pointerdown", press(0));
  dispatch(annotating.surface, "pointerdown", press(2, false, "touch"));
  assert.deepEqual(annotating.intents, []);
  const reading = setup("trackpad", "read");
  dispatch(reading.surface, "pointerdown", press(2));
  assert.deepEqual(reading.intents, []);
});

test("the context menu of a two-finger click is cancelled only when it counts as one", () => {
  const annotating = setup("trackpad", "annotate");
  assert.equal(dispatch(annotating.surface, "contextmenu", { button: 2 }).defaultPrevented, true);
  const reading = setup("trackpad", "read");
  assert.equal(dispatch(reading.surface, "contextmenu", { button: 2 }).defaultPrevented, false);
});

test("Safari pinch events become zoom intents from the scale step", () => {
  const { surface, intents } = setup("trackpad", "annotate");
  const start = dispatch(surface, "gesturestart", { scale: 1 });
  dispatch(surface, "gesturechange", { scale: 1.2, clientX: 10, clientY: 20 });
  dispatch(surface, "gesturechange", { scale: 1.1 });
  dispatch(surface, "gestureend", { scale: 1.1 });
  assert.equal(start.defaultPrevented, true);
  assert.equal(intents.length, 2);
  const [grow, shrink] = intents as [
    Extract<Intent, { kind: "zoom" }>,
    Extract<Intent, { kind: "zoom" }>,
  ];
  assert.equal(grow.kind, "zoom");
  assert.ok(Math.abs(grow.octaves - Math.log2(1.2)) < 1e-9);
  assert.ok(shrink.octaves < 0);
});

test("a new Safari pinch starts again from scale one", () => {
  const { surface, intents } = setup("trackpad", "annotate");
  dispatch(surface, "gesturestart", { scale: 1 });
  dispatch(surface, "gesturechange", { scale: 1.3 });
  dispatch(surface, "gestureend", { scale: 1.3 });
  dispatch(surface, "gesturestart", { scale: 1 });
  dispatch(surface, "gesturechange", { scale: 1.2 });
  const octaves = intents.map((intent) => (intent.kind === "zoom" ? intent.octaves : 0));
  assert.ok(Math.abs((octaves[1] ?? 0) - Math.log2(1.2)) < 1e-9);
});

test("a mouse gives no Safari pinch intent and removing the listeners stops everything", () => {
  const mouse = setup("mouse", "annotate");
  dispatch(mouse.surface, "gesturechange", { scale: 1.5 });
  assert.deepEqual(mouse.intents, []);
  const trackpad = setup("trackpad", "annotate");
  trackpad.stop();
  dispatch(trackpad.surface, "pointerdown", press(2));
  dispatch(trackpad.surface, "gesturechange", { scale: 1.5 });
  assert.deepEqual(trackpad.intents, []);
});

const recorded: InputTrace = {
  schema: 1,
  origin: "recorded",
  device: "trackpad",
  label: "Test trackpad in Safari on macOS",
  os: "macOS",
  browser: "Safari",
  devicePixelRatio: 2,
  viewport: { left: 0, top: 0, width: 100, height: 100 },
  userAgent: "test",
  gestures: [
    {
      gesture: "two-finger-click",
      events: [
        {
          type: "pointerdown",
          t: 0,
          clientX: 1,
          clientY: 1,
          pointerId: 1,
          pointerType: "mouse",
          button: 2,
          buttons: 2,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
        },
      ],
    },
    {
      gesture: "pinch-out",
      events: [],
      gestureEvents: [
        ["gesturestart", 1],
        ["gesturechange", 1.1],
        ["gesturechange", 1.3],
        ["gestureend", 1.3],
      ].map(([type, scale]) => ({
        type: type as "gesturestart",
        t: 0,
        clientX: 1,
        clientY: 1,
        scale: scale as number,
        rotation: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      })),
    },
  ],
};

test("a recording turns into a trackpad fixture of click and pinch steps", () => {
  const fixture = fixtureFromTrace(recorded);
  assert.equal(fixture.origin, "recorded");
  assert.match(fixture.todo, /^TODO/);
  assert.deepEqual(
    fixture.steps.map((step) => [step.type, step.expect]),
    [
      ["pointer", "negativePoint"],
      ["safariPinch", "zoom"],
      ["safariPinch", "zoom"],
    ],
  );
  const second = fixture.steps[2];
  assert.equal(second?.type === "safariPinch" ? second.previousScale : null, 1.1);
});
