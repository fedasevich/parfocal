import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createGestureInterpreter, type ViewerInput } from "@parfocal/viewer-engine";
import {
  buildTrace,
  defaultTiming,
  describeAgent,
  doubleClickRecord,
  finishGesture,
  momentAt,
  pointerRecord,
  timingFromSearch,
  traceFileBody,
  traceFileName,
  wheelRecord,
} from "../src/screens/input-traces/recording.ts";
import { deviceProfiles, type TraceStep } from "../src/screens/input-traces/steps.ts";
import type {
  InputTrace,
  TraceEvent,
  TraceGesture,
} from "../src/screens/input-traces/trace-format.ts";

const none = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
const macAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const viewport = { left: 100, top: 80, width: 800, height: 320 };

function stepOf(profileId: string, stepId: string): TraceStep {
  const step = deviceProfiles
    .find((profile) => profile.id === profileId)
    ?.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) throw new Error(`No step ${stepId} in ${profileId}`);
  return step;
}

function wheels(
  deltas: readonly (readonly [number, number])[],
  modifiers: Partial<typeof none> = {},
  start = 5000,
  gap = 16,
): TraceEvent[] {
  return deltas.map(([deltaX, deltaY], index) =>
    wheelRecord({
      timeStamp: start + index * gap,
      clientX: 500,
      clientY: 240,
      deltaX,
      deltaY,
      deltaMode: 0,
      ...none,
      ...modifiers,
    }),
  );
}

function gestureOf(profileId: string, stepId: string, events: readonly TraceEvent[]): TraceGesture {
  const gesture = finishGesture(stepOf(profileId, stepId), events, []);
  if (gesture === null) throw new Error("The gesture has no events");
  return gesture;
}

function downloadedFile(profileId: string, gestures: readonly TraceGesture[]): InputTrace {
  const profile = deviceProfiles.find((candidate) => candidate.id === profileId);
  if (profile === undefined) throw new Error(`No profile ${profileId}`);
  const trace = buildTrace(profile, gestures, {
    userAgent: macAgent,
    devicePixelRatio: 2,
    viewport,
    deviceName: "",
  });
  return JSON.parse(traceFileBody(trace)) as InputTrace;
}

function viewerInput(event: TraceEvent): ViewerInput {
  const modifiers = {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
  const at = { clientX: event.clientX, clientY: event.clientY };
  if (event.type === "wheel") {
    return {
      kind: "wheel",
      ...at,
      ...modifiers,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    };
  }
  throw new Error(`The replay in this test handles wheel events only, not ${event.type}`);
}

function replay(gesture: TraceGesture) {
  const interpreter = createGestureInterpreter();
  return gesture.events.flatMap((event) => interpreter.handle(viewerInput(event)));
}

describe("the device lists", () => {
  test("a mouse, a Mac trackpad and an optional Windows touchpad each list their steps", () => {
    assert.deepEqual(
      deviceProfiles.map((profile) => [profile.id, profile.device, profile.optional]),
      [
        ["mouse", "mouse", false],
        ["mac-trackpad", "trackpad", false],
        ["windows-touchpad", "trackpad", true],
      ],
    );
    for (const profile of deviceProfiles) {
      assert.ok(profile.steps.length >= 8);
      assert.equal(new Set(profile.steps.map((step) => step.id)).size, profile.steps.length);
    }
  });

  test("the trackpad lists cover scrolling, sideways scrolling and both pinches", () => {
    for (const id of ["mac-trackpad", "windows-touchpad"]) {
      const names = new Set(
        deviceProfiles.find((profile) => profile.id === id)?.steps.map((s) => s.gesture),
      );
      for (const wanted of [
        "scroll-down",
        "scroll-up",
        "scroll-sideways",
        "pinch-out",
        "pinch-in",
      ]) {
        assert.ok(names.has(wanted as never), `${id} lacks ${wanted}`);
      }
    }
  });
});

describe("the timeline", () => {
  test("it counts down for 3 seconds and records for 5 seconds by default", () => {
    assert.deepEqual(defaultTiming, { countdownMs: 3000, recordMs: 5000 });
    assert.deepEqual(momentAt(0, defaultTiming), { kind: "countdown", remainingMs: 3000 });
    assert.deepEqual(momentAt(2999, defaultTiming), { kind: "countdown", remainingMs: 1 });
    assert.deepEqual(momentAt(3000, defaultTiming), {
      kind: "recording",
      elapsedMs: 0,
      remainingMs: 5000,
    });
    assert.deepEqual(momentAt(7999, defaultTiming).kind, "recording");
    assert.deepEqual(momentAt(8000, defaultTiming), { kind: "finished" });
  });

  test("the address can shorten it for tests and ignores nonsense", () => {
    assert.deepEqual(timingFromSearch("?countdown=0.2&record=0.5"), {
      countdownMs: 200,
      recordMs: 500,
    });
    assert.deepEqual(timingFromSearch("?countdown=abc&record=-1"), defaultTiming);
    assert.deepEqual(timingFromSearch(""), defaultTiming);
  });
});

describe("a recorded gesture", () => {
  test("an empty recording leaves the step out", () => {
    assert.equal(finishGesture(stepOf("mouse", "drag"), [], []), null);
  });

  test("times start at zero on the first event and keep a tenth of a millisecond", () => {
    const gesture = gestureOf(
      "mouse",
      "scroll-down-slow",
      wheels(
        [
          [0, 100],
          [0, 100],
        ],
        {},
        9000.04,
        87.33,
      ),
    );
    assert.deepEqual(
      gesture.events.map((event) => event.t),
      [0, 87.3],
    );
    assert.equal(gesture.variant, "slowly");
  });

  test("Safari gesture events travel in their own list and share the time origin", () => {
    const gesture = finishGesture(
      stepOf("mac-trackpad", "pinch-out-slow"),
      wheels([[0, -3]], {}, 2000),
      [
        {
          type: "gesturestart",
          t: 1990,
          clientX: 1,
          clientY: 2,
          scale: 1,
          rotation: 0,
          ...none,
        },
      ],
    );
    assert.equal(gesture?.gestureEvents?.[0]?.t, 0);
    assert.equal(gesture?.events[0]?.t, 10);
  });

  test("agents are described by operating system and browser", () => {
    assert.deepEqual(describeAgent(macAgent), { os: "macOS", browser: "Chrome" });
    assert.deepEqual(describeAgent("Mozilla/5.0 (Windows NT 10.0) Edg/130.0"), {
      os: "Windows",
      browser: "Edge",
    });
  });
});

describe("the downloaded file replays through the viewer engine", () => {
  test("a mouse file is named for its device and zooms on every notch", () => {
    const trace = downloadedFile("mouse", [
      gestureOf(
        "mouse",
        "scroll-down-slow",
        wheels(
          [
            [0, 100],
            [0, 100],
            [0, 100],
          ],
          {},
          5000,
          90,
        ),
      ),
      gestureOf("mouse", "double-click", [
        pointerRecord("pointerdown", {
          timeStamp: 100,
          clientX: 400,
          clientY: 200,
          pointerId: 1,
          pointerType: "mouse",
          button: 0,
          buttons: 1,
          ...none,
        }),
        doubleClickRecord({ timeStamp: 180, clientX: 400, clientY: 200, button: 0, ...none }),
      ]),
    ]);
    assert.equal(traceFileName(trace), "mouse-macos-chrome.recorded.json");
    assert.equal(trace.schema, 1);
    assert.equal(trace.origin, "recorded");
    assert.equal(trace.device, "mouse");
    assert.deepEqual(trace.viewport, viewport);
    const scroll = trace.gestures[0];
    assert.ok(scroll);
    const zooms = replay(scroll).filter((action) => action.kind === "zoom");
    assert.equal(zooms.length, 3);
    for (const zoom of zooms) {
      assert.ok(zoom.kind === "zoom" && zoom.animate && zoom.octaves < 0);
    }
  });

  test("a trackpad file pans on scrolling and follows a pinch without easing", () => {
    const scroll = wheels(
      [
        [0, 6.5],
        [0, 7.25],
        [0, 8.75],
        [0, 5.5],
        [0, 4.25],
      ],
      {},
      3000,
    );
    const pinch = wheels(
      [
        [0, -3.4],
        [0, -4.6],
        [0, -5.2],
        [0, -4.8],
      ],
      { ctrlKey: true },
      9000,
    );
    const trace = downloadedFile("mac-trackpad", [
      gestureOf("mac-trackpad", "scroll-down-slow", scroll),
      gestureOf("mac-trackpad", "pinch-out-slow", pinch),
    ]);
    assert.equal(traceFileName(trace), "trackpad-macos-chrome.recorded.json");
    assert.equal(trace.label, "Mac trackpad in Chrome on macOS");
    const [scrolling, pinching] = trace.gestures;
    assert.ok(scrolling && pinching);
    const pans = replay(scrolling).filter((action) => action.kind === "pan");
    assert.ok(pans.length >= scrolling.events.length * 0.8);
    const zooms = replay(pinching).filter((action) => action.kind === "zoom");
    assert.equal(zooms.length, pinching.events.length);
    for (const zoom of zooms) {
      assert.ok(zoom.kind === "zoom" && !zoom.animate && zoom.octaves > 0);
    }
  });
});
