import assert from "node:assert/strict";
import { test } from "node:test";
import { createActor } from "xstate";
import {
  fadeDistance,
  type MinimapEvent,
  type MinimapMode,
  type MinimapValue,
  mapExtent,
  minimapMachine,
  type PeekState,
  paddedArea,
  pointerDistance,
  sizeOfMode,
} from "../src/lib/minimap-machine.ts";

type Model = {
  share: number;
  magnification: number;
  focus: boolean;
  skips: number;
  mode: MinimapMode;
  fade: "clear" | "faded";
  peek: PeekState;
};

const start: Model = {
  share: 1,
  magnification: 0,
  focus: false,
  skips: 0,
  mode: "hidden",
  fade: "clear",
  peek: "closed",
};

function settle(model: Model): Model {
  let mode = model.mode;
  for (let round = 0; round < 8; round += 1) {
    let next = mode;
    if (mode === "hidden" && model.share <= 0.5) next = "reading";
    else if (mode === "reading") {
      if (model.share > 0.5) next = "hidden";
      else if (model.magnification >= 20) next = "area";
    } else if (mode === "area") {
      if (model.share > 0.5) next = "hidden";
      else if (model.focus) next = "locator";
      else if (model.magnification < 20) next = "reading";
    } else if (mode === "locator" && !model.focus) next = "area";
    if (next === mode) break;
    mode = next;
  }
  return { ...model, mode };
}

function advance(model: Model, event: MinimapEvent): Model {
  const peekClosedBefore = model.peek === "closed";
  let next: Model = { ...model };
  switch (event.type) {
    case "CAMERA":
      next = { ...next, share: event.tissueShare, magnification: event.magnification };
      break;
    case "FOCUS_ENTER":
      next.focus = true;
      break;
    case "FOCUS_EXIT":
      next.focus = false;
      break;
    case "ESC":
      if (model.focus && peekClosedBefore) next.focus = false;
      if (model.peek === "held" || model.peek === "latched") next.peek = "closed";
      break;
    case "TRAVEL_START":
      if (model.mode === "reading" || model.mode === "area" || model.mode === "locator") {
        next.mode = "travel";
        next.skips = 0;
      }
      break;
    case "TRAVEL_SKIP":
      if (model.mode === "travel") next.skips += 1;
      break;
    case "TRAVEL_ARRIVE":
      if (model.mode === "travel") next.mode = "reading";
      break;
    case "POINTER":
      next.fade = event.distance <= fadeDistance ? "faded" : "clear";
      break;
    case "PEEK_HOLD_START":
      if (model.peek === "closed") next.peek = "held";
      else if (model.peek === "latched") next.peek = "closing";
      break;
    case "PEEK_HOLD_END":
      if (model.peek === "held" || model.peek === "closing") next.peek = "closed";
      break;
    case "PEEK_TAP":
      if (model.peek === "closed") next.peek = "latched";
      else if (model.peek === "closing") next.peek = "closed";
      break;
    case "PEEK_CLOSE":
      if (model.peek === "held" || model.peek === "latched") next.peek = "closed";
      break;
    case "MAP_CLICK":
      if (model.peek === "closed") next.peek = "latched";
      break;
    default:
      break;
  }
  return settle(next);
}

const whole = { type: "CAMERA", tissueShare: 0.9, magnification: 1 } as const;
const edgeOfHalf = { type: "CAMERA", tissueShare: 0.5, magnification: 5 } as const;
const reading = { type: "CAMERA", tissueShare: 0.2, magnification: 10 } as const;
const justBelowArea = { type: "CAMERA", tissueShare: 0.01, magnification: 19.9 } as const;
const zoomed = { type: "CAMERA", tissueShare: 0.01, magnification: 20 } as const;

const alphabet: MinimapEvent[] = [
  whole,
  reading,
  zoomed,
  { type: "FOCUS_ENTER" },
  { type: "FOCUS_EXIT" },
  { type: "ESC" },
  { type: "TRAVEL_START" },
  { type: "TRAVEL_SKIP" },
  { type: "TRAVEL_ARRIVE" },
  { type: "POINTER", distance: 10 },
  { type: "POINTER", distance: 400 },
  { type: "PEEK_HOLD_START" },
  { type: "PEEK_HOLD_END" },
  { type: "PEEK_TAP" },
  { type: "PEEK_CLOSE" },
  { type: "MAP_CLICK" },
];

function run(events: MinimapEvent[]) {
  const actor = createActor(minimapMachine);
  actor.start();
  for (const event of events) actor.send(event);
  const snapshot = actor.getSnapshot();
  actor.stop();
  return {
    value: snapshot.value,
    context: snapshot.context,
  };
}

function expectModel(events: MinimapEvent[]) {
  const got = run(events);
  const want = events.reduce(advance, start);
  const label = JSON.stringify(events.map((event) => event.type));
  assert.equal(got.value.mode, want.mode, `mode after ${label}`);
  assert.equal(got.value.fade, want.fade, `fade after ${label}`);
  assert.equal(got.value.peek, want.peek, `peek after ${label}`);
  assert.equal(got.context.focus, want.focus, `focus after ${label}`);
  assert.equal(got.context.skips, want.skips, `skips after ${label}`);
}

test("the machine starts hidden with the fade clear and the peek closed", () => {
  const { value } = run([]);
  assert.deepEqual(value, { mode: "hidden", fade: "clear", peek: "closed" });
});

test("every sequence of up to three events lands where the reference model says", () => {
  let checked = 0;
  const walk = (prefix: MinimapEvent[], depth: number) => {
    expectModel(prefix);
    checked += 1;
    if (depth === 0) return;
    for (const event of alphabet) walk([...prefix, event], depth - 1);
  };
  walk([], 3);
  assert.ok(checked > 4000);
});

test("hidden goes to reading once half or less of the tissue is on screen", () => {
  assert.equal(run([whole]).value.mode, "hidden");
  assert.equal(run([edgeOfHalf]).value.mode, "reading");
  assert.equal(run([{ type: "CAMERA", tissueShare: 0.51, magnification: 5 }]).value.mode, "hidden");
});

test("reading goes to area at 20x and back below it", () => {
  assert.equal(run([reading]).value.mode, "reading");
  assert.equal(run([reading, justBelowArea]).value.mode, "reading");
  assert.equal(run([reading, zoomed]).value.mode, "area");
  assert.equal(run([zoomed, justBelowArea]).value.mode, "reading");
});

test("reading goes back to hidden when more than half the tissue is on screen again", () => {
  assert.equal(run([reading, whole]).value.mode, "hidden");
  assert.equal(run([zoomed, whole]).value.mode, "hidden");
});

test("area goes to the locator on focus mode and back on Esc", () => {
  assert.equal(run([zoomed, { type: "FOCUS_ENTER" }]).value.mode, "locator");
  assert.equal(run([zoomed, { type: "FOCUS_ENTER" }, { type: "ESC" }]).value.mode, "area");
  assert.equal(run([zoomed, { type: "FOCUS_ENTER" }, { type: "FOCUS_EXIT" }]).value.mode, "area");
});

test("focus mode entered before 20x turns into the locator once the camera arrives", () => {
  assert.equal(run([reading, { type: "FOCUS_ENTER" }]).value.mode, "reading");
  assert.equal(run([reading, { type: "FOCUS_ENTER" }, zoomed]).value.mode, "locator");
});

test("Esc with the peek open closes only the peek and keeps the locator", () => {
  const events: MinimapEvent[] = [
    zoomed,
    { type: "FOCUS_ENTER" },
    { type: "PEEK_TAP" },
    { type: "ESC" },
  ];
  const { value, context } = run(events);
  assert.equal(value.peek, "closed");
  assert.equal(value.mode, "locator");
  assert.equal(context.focus, true);
  assert.equal(run([...events, { type: "ESC" }]).value.mode, "area");
});

test("travel starts from reading, area and the locator, and not from hidden", () => {
  assert.equal(run([reading, { type: "TRAVEL_START" }]).value.mode, "travel");
  assert.equal(run([zoomed, { type: "TRAVEL_START" }]).value.mode, "travel");
  assert.equal(
    run([zoomed, { type: "FOCUS_ENTER" }, { type: "TRAVEL_START" }]).value.mode,
    "travel",
  );
  assert.equal(run([whole, { type: "TRAVEL_START" }]).value.mode, "hidden");
  assert.equal(run([{ type: "TRAVEL_START" }]).value.mode, "hidden");
});

test("travel ends in reading on arrival, then follows the camera", () => {
  assert.equal(
    run([reading, { type: "TRAVEL_START" }, { type: "TRAVEL_ARRIVE" }]).value.mode,
    "reading",
  );
  assert.equal(
    run([zoomed, { type: "TRAVEL_START" }, { type: "TRAVEL_ARRIVE" }]).value.mode,
    "area",
  );
  assert.equal(
    run([zoomed, { type: "FOCUS_ENTER" }, { type: "TRAVEL_START" }, { type: "TRAVEL_ARRIVE" }])
      .value.mode,
    "locator",
  );
});

test("the camera moving during travel does not leave travel", () => {
  const { value } = run([reading, { type: "TRAVEL_START" }, zoomed, whole, reading]);
  assert.equal(value.mode, "travel");
});

test("a second press during travel counts as a skip and the count resets on the next trip", () => {
  const trip: MinimapEvent[] = [reading, { type: "TRAVEL_START" }, { type: "TRAVEL_SKIP" }];
  assert.equal(run(trip).context.skips, 1);
  assert.equal(run([...trip, { type: "TRAVEL_SKIP" }]).context.skips, 2);
  assert.equal(
    run([...trip, { type: "TRAVEL_ARRIVE" }, { type: "TRAVEL_START" }]).context.skips,
    0,
  );
  assert.equal(run([reading, { type: "TRAVEL_SKIP" }]).context.skips, 0);
});

test("the map fades within 40 px of the pointer and clears beyond", () => {
  assert.equal(run([{ type: "POINTER", distance: 40 }]).value.fade, "faded");
  assert.equal(run([{ type: "POINTER", distance: 0 }]).value.fade, "faded");
  assert.equal(run([{ type: "POINTER", distance: 40.5 }]).value.fade, "clear");
  assert.equal(
    run([
      { type: "POINTER", distance: 10 },
      { type: "POINTER", distance: 41 },
    ]).value.fade,
    "clear",
  );
});

test("fade applies in every mode and survives mode changes", () => {
  for (const [events, mode] of [
    [[reading], "reading"],
    [[zoomed], "area"],
    [[zoomed, { type: "FOCUS_ENTER" }], "locator"],
    [[reading, { type: "TRAVEL_START" }], "travel"],
  ] as [MinimapEvent[], MinimapMode][]) {
    const { value } = run([...events, { type: "POINTER", distance: 5 }]);
    assert.equal(value.mode, mode);
    assert.equal(value.fade, "faded");
  }
  const { value } = run([{ type: "POINTER", distance: 5 }, reading, zoomed]);
  assert.equal(value.fade, "faded");
});

test("holding Z opens the peek and releasing closes it", () => {
  assert.equal(run([{ type: "PEEK_HOLD_START" }]).value.peek, "held");
  assert.equal(run([{ type: "PEEK_HOLD_START" }, { type: "PEEK_HOLD_END" }]).value.peek, "closed");
});

test("a tap on Z latches the peek until Z, Esc or a click", () => {
  const latched: MinimapEvent[] = [{ type: "PEEK_TAP" }];
  assert.equal(run(latched).value.peek, "latched");
  assert.equal(run([...latched, { type: "ESC" }]).value.peek, "closed");
  assert.equal(run([...latched, { type: "PEEK_CLOSE" }]).value.peek, "closed");
  const pressedAgain = run([...latched, { type: "PEEK_HOLD_START" }]);
  assert.equal(pressedAgain.value.peek, "closing");
  assert.equal(
    run([...latched, { type: "PEEK_HOLD_START" }, { type: "PEEK_TAP" }]).value.peek,
    "closed",
  );
  assert.equal(
    run([...latched, { type: "PEEK_HOLD_START" }, { type: "PEEK_HOLD_END" }]).value.peek,
    "closed",
  );
});

test("the key still down after Z closed the peek does not open it again", () => {
  const { value } = run([
    { type: "PEEK_TAP" },
    { type: "PEEK_HOLD_START" },
    { type: "PEEK_HOLD_END" },
  ]);
  assert.equal(value.peek, "closed");
});

test("a click on the map opens the peek even while the map is faded", () => {
  const { value } = run([reading, { type: "POINTER", distance: 3 }, { type: "MAP_CLICK" }]);
  assert.equal(value.fade, "faded");
  assert.equal(value.peek, "latched");
});

test("the peek runs while the map is hidden", () => {
  assert.deepEqual(run([whole, { type: "PEEK_HOLD_START" }]).value, {
    mode: "hidden",
    fade: "clear",
    peek: "held",
  });
});

test("each mode maps to the size the kit names", () => {
  assert.equal(sizeOfMode("hidden"), "hidden");
  assert.equal(sizeOfMode("reading"), "full");
  assert.equal(sizeOfMode("area"), "compact");
  assert.equal(sizeOfMode("locator"), "pip");
  assert.equal(sizeOfMode("travel"), "travel");
});

test("the area map pads the area by 12% of its longer side and stays on the slide", () => {
  const slide: [number, number, number, number] = [0, 0, 1400, 1924];
  assert.deepEqual(paddedArea([500, 600, 100, 200], slide), [476, 576, 148, 248]);
  assert.deepEqual(paddedArea([5, 1900, 100, 100], slide), [0, 1888, 117, 36]);
  assert.deepEqual(mapExtent("reading", slide, [500, 600, 100, 200]), slide);
  assert.deepEqual(mapExtent("travel", slide, [500, 600, 100, 200]), slide);
  assert.deepEqual(mapExtent("area", slide, [500, 600, 100, 200]), [476, 576, 148, 248]);
  assert.deepEqual(mapExtent("locator", slide, [500, 600, 100, 200]), [476, 576, 148, 248]);
});

test("the pointer distance is zero inside the box and measured from its edge outside", () => {
  const box = { left: 100, top: 100, width: 200, height: 300 };
  assert.equal(pointerDistance([150, 150], box), 0);
  assert.equal(pointerDistance([60, 250], box), 40);
  assert.equal(pointerDistance([300, 430], box), 30);
  assert.equal(pointerDistance([330, 440], box), 50);
});
