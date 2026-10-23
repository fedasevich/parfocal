import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  type CameraControllerHost,
  clampCamera,
  coastDecayMs,
  createCameraController,
  type ScreenOffset,
  type SlidePoint,
} from "../src/index.ts";

const limits = { minZoom: -10, maxZoom: 2 };

function setup(start: Camera = { x: 10_000, y: 8000, zoom: -2 }, animates = true) {
  const clock = { time: 0 };
  const applied: Camera[] = [];
  let camera = start;
  let frameRequests = 0;
  const host: CameraControllerHost = {
    bounds: () => limits,
    now: () => clock.time,
    getCamera: () => camera,
    applyCamera: (next) => {
      camera = clampCamera(next, limits);
      applied.push(camera);
    },
    viewport: () => ({ width: 800, height: 600 }),
    requestFrame: () => {
      frameRequests += 1;
    },
    animates: () => animates,
  };
  const controller = createCameraController(host);
  const run = (frameMs = 16, limit = 1000) => {
    let frames = 0;
    let moving = true;
    while (moving) {
      if (frames >= limit) throw new Error("Still moving");
      clock.time += frameMs;
      moving = controller.step();
      frames += 1;
    }
    return frames;
  };
  return {
    controller,
    clock,
    applied,
    run,
    camera: () => camera,
    frameRequests: () => frameRequests,
  };
}

function pointUnder(camera: Camera, anchor: ScreenOffset): SlidePoint {
  const scale = 2 ** camera.zoom;
  return { x: camera.x + anchor.x / scale, y: camera.y + anchor.y / scale };
}

const close = (a: number, b: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

test("panning moves the content by screen pixels at the current zoom", () => {
  const { controller, camera } = setup({ x: 1000, y: 1000, zoom: -2 });
  controller.panBy(10, -5);
  assert.deepEqual(camera(), { x: 960, y: 1020, zoom: -2 });
});

test("an instant zoom keeps the slide point under the cursor", () => {
  const { controller, camera } = setup();
  const cursor = { x: 250, y: -130 };
  const before = pointUnder(camera(), cursor);
  controller.zoomTo(0.5, cursor, { animate: false });
  assert.equal(camera().zoom, 0.5);
  const after = pointUnder(camera(), cursor);
  close(after.x, before.x);
  close(after.y, before.y);
});

test("an eased zoom keeps the point under the cursor on every frame and ends on the target", () => {
  const { controller, camera, applied, run } = setup();
  const cursor = { x: -300, y: 200 };
  const before = pointUnder(camera(), cursor);
  controller.zoomBy(1.5, cursor);
  assert.equal(controller.motion(), "zooming");
  const frames = run();
  assert.ok(frames > 2);
  assert.equal(camera().zoom, -0.5);
  for (const step of applied) {
    const point = pointUnder(step, cursor);
    close(point.x, before.x);
    close(point.y, before.y);
  }
  assert.equal(controller.motion(), "idle");
});

test("zoom steps add up while an eased zoom is still running", () => {
  const { controller, camera, clock, run } = setup({ x: 0, y: 0, zoom: -4 });
  controller.zoomBy(1);
  clock.time += 16;
  controller.step();
  controller.zoomBy(1);
  run();
  assert.equal(camera().zoom, -2);
});

test("zooming past a limit stops at the limit without the view drifting sideways", () => {
  const { controller, camera, applied, run } = setup({ x: 5000, y: 5000, zoom: 1.5 });
  const cursor = { x: 300, y: 250 };
  const before = pointUnder(camera(), cursor);
  controller.zoomBy(3, cursor);
  controller.zoomBy(3, cursor);
  run();
  assert.equal(camera().zoom, limits.maxZoom);
  for (const step of applied) {
    assert.ok(step.zoom <= limits.maxZoom);
    close(pointUnder(step, cursor).x, before.x);
    close(pointUnder(step, cursor).y, before.y);
  }
  controller.zoomBy(-40, cursor, { animate: false });
  assert.equal(camera().zoom, limits.minZoom);
});

test("a fast drag released while moving coasts on and slows to a stop", () => {
  const { controller, camera, clock, run } = setup({ x: 1000, y: 1000, zoom: 0 });
  controller.startDrag(100, 100);
  for (let step = 1; step <= 5; step += 1) {
    clock.time += 10;
    controller.dragTo(100 + step * 20, 100);
  }
  assert.deepEqual(camera(), { x: 900, y: 1000, zoom: 0 });
  controller.endDrag();
  assert.equal(controller.motion(), "coasting");
  run();
  assert.equal(controller.motion(), "idle");
  const coasted = 900 - camera().x;
  const throwSpeed = 2;
  assert.ok(coasted > 0.9 * throwSpeed * coastDecayMs);
  assert.ok(coasted <= throwSpeed * coastDecayMs);
  assert.equal(camera().y, 1000);
});

test("a drag held still before release does not coast", () => {
  const { controller, camera, clock } = setup({ x: 0, y: 0, zoom: 0 });
  controller.startDrag(0, 0);
  clock.time += 10;
  controller.dragTo(30, 0);
  clock.time += 200;
  controller.endDrag();
  assert.equal(controller.motion(), "idle");
  assert.equal(camera().x, -30);
});

test("coasting is off when motion is reduced", () => {
  const { controller, clock } = setup({ x: 0, y: 0, zoom: 0 }, false);
  controller.startDrag(0, 0);
  clock.time += 10;
  controller.dragTo(40, 0);
  controller.endDrag();
  assert.equal(controller.motion(), "idle");
});

test("a flight between two areas ends exactly on the second and resolves arrived", async () => {
  const first = { x: 4000, y: 3000, zoom: -1 };
  const second = { x: 36_000, y: 27_000, zoom: 0.5 };
  const { controller, camera, applied, run } = setup(first);
  const end = controller.flyTo(second);
  assert.equal(controller.motion(), "flying");
  const frames = run(16);
  assert.deepEqual(camera(), second);
  assert.equal(await end, "arrived");
  assert.ok(frames * 16 >= 400 && frames * 16 <= 700 + 16);
  assert.ok(Math.min(...applied.map((step) => step.zoom)) < first.zoom);
});

test("a flight to a target beyond the zoom limits ends on the clamped target", async () => {
  const { controller, camera, run } = setup({ x: 0, y: 0, zoom: 0 });
  const end = controller.flyTo({ x: 9000, y: 100, zoom: 9 });
  run();
  assert.deepEqual(camera(), { x: 9000, y: 100, zoom: limits.maxZoom });
  assert.equal(await end, "arrived");
});

test("any new input cancels a flight where it is", async () => {
  const inputs: Record<string, (controller: ReturnType<typeof setup>["controller"]) => void> = {
    pan: (controller) => controller.panBy(1, 0),
    drag: (controller) => controller.startDrag(0, 0),
    zoom: (controller) => controller.zoomBy(0.5),
    flight: (controller) => void controller.flyTo({ x: 0, y: 0, zoom: -3 }),
    cancel: (controller) => controller.cancel(),
    interrupt: (controller) => controller.interrupt(),
  };
  for (const [name, input] of Object.entries(inputs)) {
    const { controller, camera, clock } = setup({ x: 0, y: 0, zoom: -2 });
    const end = controller.flyTo({ x: 30_000, y: 0, zoom: -2 });
    clock.time += 100;
    controller.step();
    const midway = camera();
    assert.ok(midway.x > 0 && midway.x < 30_000, name);
    input(controller);
    assert.equal(await end, "cancelled", name);
    if (name !== "flight") assert.notEqual(controller.motion(), "flying", name);
    clock.time += 1000;
    controller.step();
    assert.ok(camera().x < 30_000, name);
  }
});

test("interrupting stops a coast but leaves an eased zoom to finish", () => {
  const { controller, clock, run, camera } = setup({ x: 0, y: 0, zoom: 0 });
  controller.startDrag(0, 0);
  clock.time += 10;
  controller.dragTo(40, 0);
  controller.endDrag();
  controller.interrupt();
  assert.equal(controller.motion(), "idle");
  controller.zoomBy(1);
  controller.interrupt();
  assert.equal(controller.motion(), "zooming");
  run();
  assert.equal(camera().zoom, 1);
});

test("settling jumps a flight to its end and resolves arrived", async () => {
  const { controller, camera, clock } = setup({ x: 0, y: 0, zoom: -2 });
  const end = controller.flyTo({ x: 5000, y: 5000, zoom: -1 });
  clock.time += 50;
  controller.step();
  controller.settle();
  assert.deepEqual(camera(), { x: 5000, y: 5000, zoom: -1 });
  assert.equal(await end, "arrived");
});

test("without animation a flight jumps straight to the target", async () => {
  const { controller, camera, frameRequests } = setup({ x: 0, y: 0, zoom: -2 }, false);
  assert.equal(await controller.flyTo({ x: 100, y: 200, zoom: 0 }), "arrived");
  assert.deepEqual(camera(), { x: 100, y: 200, zoom: 0 });
  assert.equal(frameRequests(), 0);
});

test("a flight to where the camera already is arrives at once", async () => {
  const { controller, frameRequests } = setup({ x: 1, y: 2, zoom: -1 });
  assert.equal(await controller.flyTo({ x: 1, y: 2, zoom: -1 }), "arrived");
  assert.equal(frameRequests(), 0);
});
