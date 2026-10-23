import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampZoom,
  coastDecayMs,
  coastStep,
  coastStopSpeed,
  defaultZoomLimits,
  easeZoomStep,
  keepRecentSamples,
  magnificationAtZoom,
  minimumThrowSpeed,
  nearestObjectivePreset,
  objectivePresets,
  releaseIdleMs,
  releaseVelocity,
  velocityWindowMs,
  zoomForMagnification,
  zoomSettleOctaves,
} from "../src/index.ts";

const near = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test("a release velocity is the pointer travel over the sampled time", () => {
  const samples = [
    { x: 100, y: 100, time: 0 },
    { x: 130, y: 120, time: 20 },
    { x: 160, y: 140, time: 40 },
  ];
  assert.deepEqual(releaseVelocity(samples, 45), { x: 1.5, y: 1 });
});

test("a slow drag, a pause before release or a single sample does not throw", () => {
  const slow = [
    { x: 0, y: 0, time: 0 },
    { x: 1, y: 0, time: 50 },
  ];
  assert.ok(1 / 50 < minimumThrowSpeed);
  assert.equal(releaseVelocity(slow, 50), null);
  const fast = [
    { x: 0, y: 0, time: 0 },
    { x: 40, y: 0, time: 20 },
  ];
  assert.notEqual(releaseVelocity(fast, 20 + releaseIdleMs), null);
  assert.equal(releaseVelocity(fast, 21 + releaseIdleMs), null);
  assert.equal(releaseVelocity([{ x: 0, y: 0, time: 0 }], 0), null);
});

test("only the samples of the last velocity window are kept, and never fewer than two", () => {
  const samples = [
    { x: 0, y: 0, time: 0 },
    { x: 5, y: 0, time: 10 },
    { x: 10, y: 0, time: 100 },
    { x: 15, y: 0, time: 110 },
  ];
  assert.deepEqual(
    keepRecentSamples(samples, 110).map((sample) => sample.time),
    [100, 110],
  );
  assert.deepEqual(
    keepRecentSamples(samples.slice(0, 2), 10 + velocityWindowMs * 10).map((sample) => sample.time),
    [0, 10],
  );
});

test("a coast travels the velocity times the decay time in total", () => {
  const velocity = { x: 2, y: -1 };
  const total = coastStep(velocity, 1e9);
  near(total.dx, 2 * coastDecayMs, 1e-6);
  near(total.dy, -coastDecayMs, 1e-6);
  near(total.velocity.x, 0);
});

test("a coast covers the same ground whatever the frame rate", () => {
  const velocity = { x: 3, y: 0 };
  const run = (frameMs: number, frames: number) => {
    let current = velocity;
    let travelled = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const next = coastStep(current, frameMs);
      travelled += next.dx;
      current = next.velocity;
    }
    return { travelled, speed: current.x };
  };
  const at60 = run(1000 / 60, 30);
  const at120 = run(1000 / 120, 60);
  const once = coastStep(velocity, 500);
  near(at60.travelled, once.dx, 1e-9);
  near(at120.travelled, once.dx, 1e-9);
  near(at60.speed, once.velocity.x, 1e-12);
});

test("a coast slows below the stop speed in a bounded time", () => {
  const start = 5;
  const elapsed = coastDecayMs * Math.log(start / coastStopSpeed);
  near(coastStep({ x: start, y: 0 }, elapsed).velocity.x, coastStopSpeed, 1e-9);
});

test("a negative or zero frame time moves nothing", () => {
  assert.deepEqual(coastStep({ x: 1, y: 1 }, -5), { dx: 0, dy: 0, velocity: { x: 1, y: 1 } });
  assert.equal(easeZoomStep(-3, 1, 0), -3);
});

test("an eased zoom approaches its target without overshoot and snaps at the end", () => {
  let zoom = -4;
  const seen: number[] = [];
  for (let frame = 0; frame < 100 && zoom !== 0; frame += 1) {
    zoom = easeZoomStep(zoom, 0, 16);
    seen.push(zoom);
  }
  assert.equal(zoom, 0);
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok((seen[index] ?? 0) >= (seen[index - 1] ?? 0));
    assert.ok((seen[index] ?? 1) <= 0);
  }
  assert.equal(easeZoomStep(-zoomSettleOctaves / 2, 0, 0.001), 0);
});

test("an eased zoom reaches the same zoom whatever the frame rate", () => {
  const run = (frameMs: number, frames: number) => {
    let zoom = 2;
    for (let frame = 0; frame < frames; frame += 1) zoom = easeZoomStep(zoom, -1, frameMs);
    return zoom;
  };
  near(run(10, 6), run(30, 2), 1e-12);
});

test("zoom limits clamp in one function and the defaults hold every preset", () => {
  assert.equal(clampZoom(99, defaultZoomLimits), defaultZoomLimits.maxZoom);
  assert.equal(clampZoom(-99, defaultZoomLimits), defaultZoomLimits.minZoom);
  assert.equal(clampZoom(0.5, defaultZoomLimits), 0.5);
  for (const micronsPerPixel of [0.125, 0.25, 0.5, 1]) {
    for (const preset of objectivePresets) {
      const zoom = zoomForMagnification(micronsPerPixel, preset);
      assert.equal(clampZoom(zoom, defaultZoomLimits), zoom);
    }
  }
});

test("objective presets round trip through the zoom and pick the nearest on a log scale", () => {
  assert.deepEqual([...objectivePresets], [1.25, 2.5, 5, 10, 20, 40]);
  for (const preset of objectivePresets) {
    near(magnificationAtZoom(0.25, zoomForMagnification(0.25, preset)), preset, 1e-9);
  }
  assert.equal(zoomForMagnification(0.25, 40), 0);
  assert.equal(nearestObjectivePreset(14), 10);
  assert.equal(nearestObjectivePreset(15), 20);
  assert.equal(nearestObjectivePreset(0.1), 1.25);
  assert.equal(nearestObjectivePreset(400), 40);
});
