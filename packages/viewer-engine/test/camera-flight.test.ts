import assert from "node:assert/strict";
import { test } from "node:test";
import {
  easeInOutCubic,
  flightDurationMs,
  longestFlightLength,
  longestFlightMs,
  planFlight,
  shortestFlightMs,
} from "../src/index.ts";

const width = 800;

test("flight durations run from 400 to 700 ms by path length", () => {
  assert.equal(shortestFlightMs, 400);
  assert.equal(longestFlightMs, 700);
  assert.equal(flightDurationMs(0), 400);
  assert.equal(flightDurationMs(longestFlightLength / 2), 550);
  assert.equal(flightDurationMs(longestFlightLength), 700);
  assert.equal(flightDurationMs(longestFlightLength * 10), 700);
  let previous = 0;
  for (let length = 0; length <= 10; length += 0.25) {
    const duration = flightDurationMs(length);
    assert.ok(duration >= previous);
    previous = duration;
  }
});

test("a longer flight takes longer than a shorter one", () => {
  const from = { x: 0, y: 0, zoom: -2 };
  const near = planFlight(from, { x: 3200, y: 0, zoom: -2 }, width);
  const far = planFlight(from, { x: 32_000, y: 0, zoom: -2 }, width);
  assert.ok(near.length < far.length);
  assert.ok(near.durationMs < far.durationMs);
  assert.ok(near.durationMs >= 400);
  assert.ok(far.durationMs <= 700);
});

test("a flight starts where the camera is and ends exactly on the target", () => {
  const from = { x: 1000, y: 2000, zoom: -3 };
  const to = { x: 51_234.5, y: 20_111.25, zoom: -0.5 };
  const flight = planFlight(from, to, width);
  assert.equal(flight.at(0), from);
  assert.equal(flight.at(1), to);
  assert.equal(flight.at(1.5), to);
  const almost = flight.at(0.999_999);
  assert.ok(Math.abs(almost.x - to.x) < 1);
  assert.ok(Math.abs(almost.y - to.y) < 1);
  assert.ok(Math.abs(almost.zoom - to.zoom) < 1e-3);
});

test("a flight across the slide zooms out on the way and moves in a straight line", () => {
  const from = { x: 0, y: 0, zoom: -1 };
  const to = { x: 40_000, y: 30_000, zoom: -1 };
  const flight = planFlight(from, to, width);
  const middle = flight.at(0.5);
  assert.ok(middle.zoom < from.zoom - 1);
  assert.ok(Math.abs(middle.x / 40_000 - middle.y / 30_000) < 1e-9);
  let previous = -Infinity;
  for (let step = 0; step <= 20; step += 1) {
    const point = flight.at(step / 20);
    assert.ok(point.x >= previous);
    previous = point.x;
  }
});

test("a zoom-only flight changes the zoom steadily and keeps the centre", () => {
  const from = { x: 500, y: 600, zoom: -6 };
  const to = { x: 500, y: 600, zoom: -1 };
  const flight = planFlight(from, to, width);
  assert.ok(Math.abs(flight.length - (5 * Math.LN2) / Math.SQRT2) < 1e-9);
  const quarter = flight.at(0.25);
  assert.equal(quarter.x, 500);
  assert.ok(Math.abs(quarter.zoom - -4.75) < 1e-9);
  const out = planFlight(to, from, width);
  assert.ok(Math.abs(out.at(0.5).zoom - -3.5) < 1e-9);
});

test("a flight needs a viewport", () => {
  assert.throws(() => planFlight({ x: 0, y: 0, zoom: 0 }, { x: 1, y: 0, zoom: 0 }, 0), RangeError);
});

test("the flight easing starts and ends at rest", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(2), 1);
  assert.ok(easeInOutCubic(0.01) < 0.01);
  assert.ok(easeInOutCubic(0.99) > 0.99);
});
