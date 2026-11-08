import assert from "node:assert/strict";
import { test } from "node:test";
import type { Camera, FlightEnd, SlideArea } from "@parfocal/viewer-engine";
import {
  createTravel,
  type TravelEngine,
  type TravelKeyInput,
  travelKey,
} from "../src/viewer/travel.ts";

const press = (key: string, extra: Partial<TravelKeyInput> = {}): TravelKeyInput => ({
  key,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...extra,
});

const target: SlideArea = { x: 1000, y: 2000, width: 400, height: 200 };

function fakeEngine() {
  let camera: Camera = { x: 0, y: 0, zoom: -4 };
  let settle: ((end: FlightEnd) => void) | null = null;
  const calls: string[] = [];
  const engine: TravelEngine = {
    getCamera: () => camera,
    getCameraBounds: () => ({ minZoom: -8, maxZoom: 8, width: 5000, height: 5000 }) as never,
    stopMotion: () => {
      calls.push("stop");
      settle?.("cancelled");
      settle = null;
    },
    setCamera: (next) => {
      calls.push("set");
      camera = next;
    },
    flyToArea: () => {
      calls.push("fly");
      return new Promise<FlightEnd>((resolve) => {
        settle = resolve;
      });
    },
  };
  return {
    engine,
    calls,
    moveTo: (next: Camera) => {
      camera = next;
    },
    arrive: () => {
      settle?.("arrived");
      settle = null;
    },
    camera: () => camera,
  };
}

const viewport = () => ({ width: 800, height: 600 });

test("a second ] skips, other keys cancel, modifiers and repeats are ignored", () => {
  assert.equal(travelKey(press("]")), "skip");
  assert.equal(travelKey(press("]", { metaKey: true })), "cancel");
  assert.equal(travelKey(press("ArrowLeft")), "cancel");
  assert.equal(travelKey(press("[")), "cancel");
  assert.equal(travelKey(press("Shift")), "ignore");
  assert.equal(travelKey(press("]", { repeat: true })), "ignore");
});

test("starting a flight publishes the route from the camera to the area centre", () => {
  const fake = fakeEngine();
  const travel = createTravel(fake.engine, { viewport });
  void travel.start("T2", target);
  assert.deepEqual(travel.get(), { object: "T2", from: [0, 0], to: [1200, 2100] });
  assert.deepEqual(fake.calls, ["fly"]);
});

test("a new key press cancels the flight where the camera is and does not jump to the target", () => {
  const fake = fakeEngine();
  const arrivals: string[] = [];
  const guarded = createTravel(fake.engine, {
    viewport,
    onArrive: (object) => arrivals.push(object),
  });
  void guarded.start("T2", target);
  fake.moveTo({ x: 300, y: 500, zoom: -3 });
  assert.equal(guarded.press(press("ArrowRight")), "cancel");
  assert.deepEqual(fake.camera(), { x: 300, y: 500, zoom: -3 });
  assert.equal(guarded.get(), null);
  assert.deepEqual(fake.calls, ["fly", "stop"]);
  assert.deepEqual(arrivals, []);
});

test("a second ] jumps to the area and reports a skip", () => {
  const fake = fakeEngine();
  const arrivals: string[] = [];
  const travel = createTravel(fake.engine, {
    viewport,
    onArrive: (object, end) => arrivals.push(`${object}:${end}`),
  });
  void travel.start("T2", target);
  fake.moveTo({ x: 300, y: 500, zoom: -3 });
  assert.equal(travel.press(press("]")), "skip");
  assert.deepEqual(fake.calls, ["fly", "stop", "set"]);
  assert.equal(fake.camera().x, 1200);
  assert.equal(fake.camera().y, 2100);
  assert.equal(travel.get(), null);
  assert.deepEqual(arrivals, ["T2:skipped"]);
});

test("arriving ends the travel and reports it once", async () => {
  const fake = fakeEngine();
  const arrivals: string[] = [];
  const travel = createTravel(fake.engine, {
    viewport,
    onArrive: (object, end) => arrivals.push(`${object}:${end}`),
  });
  const flight = travel.start("T1", target);
  fake.arrive();
  assert.equal(await flight, "arrived");
  assert.equal(travel.get(), null);
  assert.deepEqual(arrivals, ["T1:arrived"]);
});

test("keys do nothing when no flight is going", () => {
  const fake = fakeEngine();
  const travel = createTravel(fake.engine, { viewport });
  assert.equal(travel.press(press("ArrowLeft")), "ignore");
  assert.deepEqual(fake.calls, []);
});

test("a flight started during another replaces it and the old one does not clear the new", async () => {
  const fake = fakeEngine();
  const travel = createTravel(fake.engine, { viewport });
  const first = travel.start("T1", target);
  const second = travel.start("T2", { x: 0, y: 0, width: 10, height: 10 });
  fake.arrive();
  void first;
  assert.equal(await second, "arrived");
  assert.equal(travel.get(), null);
});
