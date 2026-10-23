import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  type CameraProfile,
  type CameraProfilePreset,
  cameraProfiles,
  clampCamera,
  coastDecayMs,
  createCameraController,
  createViewerEngine,
  defaultCameraProfile,
  type FlightEnd,
  minimumThrowSpeed,
  releaseIdleMs,
  velocityWindowMs,
  wheelZoomOctaves,
  zoomEaseMs,
} from "../src/index.ts";
import {
  FakeClock,
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  FakeSource,
  runFrames,
} from "./engine-fakes.ts";

const limits = { minZoom: -10, maxZoom: 2 };
const presets = Object.keys(cameraProfiles) as CameraProfilePreset[];

function setup(profile: CameraProfile, start: Camera = { x: 20_000, y: 15_000, zoom: -2 }) {
  const clock = { time: 0 };
  let camera = start;
  let frames = 0;
  const controller = createCameraController({
    bounds: () => limits,
    now: () => clock.time,
    getCamera: () => camera,
    applyCamera: (next) => {
      camera = clampCamera(next, limits);
    },
    viewport: () => ({ width: 800, height: 600 }),
    requestFrame: () => {},
    animates: () => true,
    profile,
  });
  const run = (frameMs = 16) => {
    const seen: Camera[] = [];
    while (controller.motion() !== "idle" && controller.motion() !== "dragging") {
      if (frames > 2000) throw new Error("Still moving");
      clock.time += frameMs;
      controller.step();
      seen.push(camera);
      frames += 1;
    }
    return seen;
  };
  const throwRight = () => {
    controller.startDrag(100, 100);
    for (let sample = 1; sample <= 5; sample += 1) {
      clock.time += 10;
      controller.dragTo(100 + sample * 20, 100);
    }
    controller.endDrag();
  };
  return { controller, clock, run, throwRight, camera: () => camera };
}

test("Smooth carries the POC's tuned values and is the default", () => {
  const smooth = cameraProfiles.smooth;
  assert.equal(defaultCameraProfile, smooth);
  assert.equal(smooth.coastDecayMs, coastDecayMs);
  assert.equal(smooth.coastDecayMs, 130);
  assert.equal(smooth.zoomEaseMs, zoomEaseMs);
  assert.equal(smooth.zoomEaseMs, 55);
  assert.equal(smooth.minimumThrowSpeed, minimumThrowSpeed);
  assert.equal(smooth.releaseIdleMs, releaseIdleMs);
  assert.equal(smooth.velocityWindowMs, velocityWindowMs);
  assert.equal(smooth.shortestFlightMs, 400);
  assert.equal(smooth.longestFlightMs, 700);
  assert.equal(smooth.wheelOctavesPerPixel * Math.LN2, 0.0022);
  assert.equal(smooth.pinchOctavesPerPixel * Math.LN2, 0.0075);
  assert.equal(smooth.maxOctavesPerEvent, 0.5);
  assert.equal(smooth.keyPanStepPx, 120);
  assert.equal(smooth.zoomAnchor, "cursor");
});

test("wheel and pinch travel turn into octaves capped per event", () => {
  const smooth = cameraProfiles.smooth;
  const notch = wheelZoomOctaves(smooth, 100, "wheel");
  assert.ok(Math.abs(notch - -0.22 / Math.LN2) < 1e-12);
  assert.equal(wheelZoomOctaves(smooth, -1000, "wheel"), 0.5);
  assert.equal(wheelZoomOctaves(smooth, 1000, "pinch"), -0.5);
  assert.ok(Math.abs(wheelZoomOctaves(smooth, -10, "pinch") - 0.075 / Math.LN2) < 1e-12);
  assert.equal(wheelZoomOctaves(smooth, Number.NaN, "wheel"), 0);
});

test("the same throw coasts under Smooth and stops on release under Precise and Instant", () => {
  const ends: Record<string, number> = {};
  for (const name of presets) {
    const { controller, throwRight, run, camera } = setup(cameraProfiles[name]);
    throwRight();
    const released = camera().x;
    const coasting = controller.motion() === "coasting";
    const frames = run().length;
    ends[name] = camera().x;
    if (name === "smooth") {
      assert.ok(coasting && frames > 10, name);
      assert.ok(camera().x < released - 200 * 0.9, name);
    } else {
      assert.equal(coasting, false, name);
      assert.equal(camera().x, released, name);
    }
  }
  assert.equal(ends.precise, ends.instant);
});

test("the same zoom step eases under Smooth, eases faster under Precise and cuts under Instant", () => {
  const frames: Record<string, number> = {};
  const ends: Record<string, Camera> = {};
  for (const name of presets) {
    const { controller, run, camera } = setup(cameraProfiles[name]);
    controller.zoomBy(1, { x: 200, y: -100 });
    frames[name] = run(8).length;
    ends[name] = camera();
  }
  assert.equal(frames.instant, 0);
  assert.ok((frames.precise ?? 0) > 0);
  assert.ok((frames.precise ?? 0) < (frames.smooth ?? 0));
  assert.deepEqual(ends.precise, ends.smooth);
  assert.deepEqual(ends.instant, ends.smooth);
});

test("the same flight takes 400 to 700 ms under Smooth, half that under Precise and none under Instant", async () => {
  const target = { x: 36_000, y: 27_000, zoom: 0 };
  for (const name of presets) {
    const { controller, run, camera, clock } = setup(cameraProfiles[name]);
    const end = controller.flyTo(target);
    run(1);
    const took = clock.time;
    assert.deepEqual(camera(), target, name);
    assert.equal(await end, "arrived", name);
    if (name === "smooth") assert.ok(took >= 400 && took <= 701, `${name} took ${took}`);
    if (name === "precise") assert.ok(took >= 200 && took <= 351, `${name} took ${took}`);
    if (name === "instant") assert.equal(took, 0, name);
  }
});

test("a centre zoom anchor ignores the cursor", () => {
  const profile: CameraProfile = { ...cameraProfiles.smooth, zoomAnchor: "centre" };
  const { controller, run, camera } = setup(profile);
  controller.zoomBy(1, { x: 300, y: 200 });
  run();
  assert.deepEqual(camera(), { x: 20_000, y: 15_000, zoom: -1 });
});

test("a profile switch mid-motion never moves the camera and never leaves a stopped motion running", async () => {
  const motions = {
    coast: (context: ReturnType<typeof setup>) => {
      context.throwRight();
      return null;
    },
    zoom: (context: ReturnType<typeof setup>) => {
      context.controller.zoomBy(2, { x: 100, y: 50 });
      return null;
    },
    flight: (context: ReturnType<typeof setup>) =>
      context.controller.flyTo({ x: 36_000, y: 2000, zoom: 0 }),
  };
  for (const from of presets) {
    for (const to of presets) {
      for (const [motion, start] of Object.entries(motions)) {
        const label = `${motion} from ${from} to ${to}`;
        const context = setup(cameraProfiles[from]);
        const flight: Promise<FlightEnd> | null = start(context);
        context.clock.time += 16;
        context.controller.step();
        const before = context.camera();
        const running = context.controller.motion();
        context.controller.setProfile(cameraProfiles[to]);
        assert.deepEqual(context.camera(), before, label);
        assert.equal(context.controller.profile(), cameraProfiles[to], label);
        const keeps =
          running === "idle" ||
          (running === "coasting" && to === "smooth") ||
          (running === "zooming" && to !== "instant") ||
          (running === "flying" && to !== "instant");
        assert.equal(context.controller.motion(), keeps ? running : "idle", label);
        context.run();
        assert.equal(context.controller.motion(), "idle", label);
        if (flight) {
          const end = await flight;
          if (running === "flying") assert.equal(end, keeps ? "arrived" : "cancelled", label);
        }
      }
    }
  }
});

test("a zoom switched from Smooth to Precise ends where Smooth would have ended", () => {
  const smooth = setup(cameraProfiles.smooth);
  smooth.controller.zoomBy(2, { x: 100, y: 50 });
  smooth.run();
  const switched = setup(cameraProfiles.smooth);
  switched.controller.zoomBy(2, { x: 100, y: 50 });
  switched.clock.time += 20;
  switched.controller.step();
  switched.controller.setProfile(cameraProfiles.precise);
  switched.run();
  assert.deepEqual(switched.camera(), smooth.camera());
});

function engineSetup(reduced: { value: boolean }) {
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const container = new FakeContainer();
  const engine = createViewerEngine({
    createRenderer: new FakeRenderer().create,
    openSlide: new FakeSource().open,
    zoomLimits: limits,
    frames,
    now: clock.now,
    reducedMotion: () => reduced.value,
    observeResize: new FakeResize().observe,
  });
  engine.mount(container);
  return { engine, frames, clock };
}

test("the engine sets the profile live and reduced motion forces Instant", async () => {
  const reduced = { value: false };
  const { engine, frames, clock } = engineSetup(reduced);
  assert.equal(engine.getCameraProfile(), cameraProfiles.smooth);
  engine.setCamera({ x: 0, y: 0, zoom: -4 });
  engine.zoomBy(1);
  assert.equal(engine.getMotion(), "zooming");
  runFrames(frames, clock);
  engine.setCameraProfile(cameraProfiles.instant);
  engine.zoomBy(1);
  assert.equal(engine.getCamera().zoom, -2);
  assert.equal(engine.getMotion(), "idle");

  engine.setCameraProfile(cameraProfiles.smooth);
  reduced.value = true;
  assert.equal(engine.getCameraProfile(), cameraProfiles.smooth);
  const end = engine.flyTo({ x: 5000, y: 5000, zoom: 0 });
  assert.deepEqual(engine.getCamera(), { x: 5000, y: 5000, zoom: 0 });
  assert.equal(await end, "arrived");
  engine.zoomBy(-1);
  assert.equal(engine.getCamera().zoom, -1);
  runFrames(frames, clock);
  assert.equal(frames.pending.size, 0);
});

test("reduced motion turning on mid-flight stops the flight where it is", async () => {
  const reduced = { value: false };
  const { engine, frames, clock } = engineSetup(reduced);
  const end = engine.flyTo({ x: 30_000, y: 0, zoom: -2 });
  clock.advance(100);
  frames.flush();
  const midway = engine.getCamera();
  reduced.value = true;
  runFrames(frames, clock);
  assert.equal(await end, "cancelled");
  assert.deepEqual(engine.getCamera(), midway);
});
