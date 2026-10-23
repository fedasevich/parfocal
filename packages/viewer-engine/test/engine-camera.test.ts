import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  createViewerEngine,
  EngineDisposedError,
  screenToSlide,
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

function setup(reducedMotion = false) {
  const renderer = new FakeRenderer();
  const source = new FakeSource();
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const resize = new FakeResize();
  const container = new FakeContainer();
  const engine = createViewerEngine({
    createRenderer: renderer.create,
    openSlide: source.open,
    zoomLimits: { minZoom: -10, maxZoom: 2 },
    frames,
    now: clock.now,
    reducedMotion: () => reducedMotion,
    observeResize: resize.observe,
  });
  return { engine, renderer, source, frames, clock, resize, container };
}

const firstArea = { x: 2000, y: 3000, width: 1600, height: 1200 };
const secondArea = { x: 30_000, y: 22_000, width: 3200, height: 2400 };

test("the engine flies from one area to another and ends exactly on the second", async () => {
  const { engine, renderer, container, frames, clock } = setup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  void engine.flyToArea(firstArea);
  runFrames(frames, clock);
  assert.deepEqual(engine.getCamera(), { x: 2800, y: 3600, zoom: -1 });

  const seen: Camera[] = [];
  engine.subscribeCamera(() => seen.push(engine.getCamera()));
  const started = clock.time;
  const end = engine.flyToArea(secondArea);
  assert.equal(engine.getMotion(), "flying");
  runFrames(frames, clock, 16);
  const expected = { x: 31_600, y: 23_200, zoom: -2 };

  assert.equal(await end, "arrived");
  assert.deepEqual(engine.getCamera(), expected);
  assert.deepEqual(renderer.last().camera, expected);
  assert.deepEqual(seen.at(-1), expected);
  assert.equal(engine.getMotion(), "idle");
  const elapsed = clock.time - started;
  assert.ok(elapsed >= 400 && elapsed <= 700 + 2 * 16, `the flight took ${elapsed} ms`);
  assert.ok(seen.length > 20);
  assert.ok(Math.min(...seen.map((camera) => camera.zoom)) < -2);
});

test("camera subscribers hear once per frame during a flight", async () => {
  const { engine, container, frames, clock } = setup();
  engine.mount(container);
  let calls = 0;
  engine.subscribeCamera(() => {
    calls += 1;
  });
  const end = engine.flyTo({ x: 20_000, y: 0, zoom: -3 });
  const count = runFrames(frames, clock, 16);
  assert.equal(await end, "arrived");
  assert.ok(calls <= count);
  assert.ok(calls >= count - 1);
});

test("a pointer down or a wheel event cancels a flight where it is", async () => {
  for (const [type, init] of [
    ["pointerdown", { clientX: 10, clientY: 10, buttons: 1 }],
    ["wheel", { clientX: 10, clientY: 10, deltaY: 100 }],
  ] as const) {
    const { engine, container, frames, clock } = setup();
    engine.mount(container);
    const end = engine.flyTo({ x: 40_000, y: 0, zoom: 0 });
    clock.advance(16);
    frames.flush();
    clock.advance(100);
    frames.flush();
    container.dispatch(type, init);
    const stopped = engine.getCamera();
    runFrames(frames, clock);
    assert.equal(await end, "cancelled", type);
    assert.deepEqual(engine.getCamera(), stopped, type);
    assert.ok(stopped.x > 0 && stopped.x < 40_000, type);
  }
});

test("setting the camera, fitting or closing the slide cancels a flight", async () => {
  const actions = {
    setCamera: (engine: ReturnType<typeof setup>["engine"]) =>
      engine.setCamera({ x: 1, y: 1, zoom: 0 }),
    fitToSlide: (engine: ReturnType<typeof setup>["engine"]) => engine.fitToSlide(),
    closeSlide: (engine: ReturnType<typeof setup>["engine"]) => engine.closeSlide(),
    stopMotion: (engine: ReturnType<typeof setup>["engine"]) => engine.stopMotion(),
  };
  for (const [name, action] of Object.entries(actions)) {
    const { engine, container, frames, clock } = setup();
    engine.mount(container);
    await engine.openSlide({ id: "a" });
    const end = engine.flyTo({ x: 100, y: 100, zoom: 1 });
    clock.advance(16);
    frames.flush();
    action(engine);
    assert.equal(await end, "cancelled", name);
    assert.equal(engine.getMotion(), "idle", name);
  }
});

test("a drag released at speed coasts through the engine frames", () => {
  const { engine, container, frames, clock } = setup();
  engine.mount(container);
  engine.setCamera({ x: 1000, y: 1000, zoom: 0 });
  engine.startDrag({ clientX: 300, clientY: 300 });
  for (let step = 1; step <= 4; step += 1) {
    clock.advance(10);
    engine.dragTo({ clientX: 300 - step * 15, clientY: 300 });
  }
  assert.deepEqual(engine.getCamera(), { x: 1060, y: 1000, zoom: 0 });
  engine.endDrag();
  assert.equal(engine.getMotion(), "coasting");
  runFrames(frames, clock);
  assert.ok(engine.getCamera().x > 1060 + 150);
  assert.equal(engine.getMotion(), "idle");
});

test("a wheel event stops a coast", () => {
  const { engine, container, frames, clock } = setup();
  engine.mount(container);
  engine.startDrag({ clientX: 300, clientY: 300 });
  clock.advance(10);
  engine.dragTo({ clientX: 340, clientY: 300 });
  engine.endDrag();
  container.dispatch("wheel", { clientX: 300, clientY: 300, deltaY: 10 });
  assert.equal(engine.getMotion(), "idle");
  assert.equal(runFrames(frames, clock), 1);
});

test("zooming at a client point keeps the slide point under it", () => {
  const { engine, container, frames, clock } = setup();
  engine.mount(container);
  engine.setCamera({ x: 5000, y: 4000, zoom: -3 });
  const at = { clientX: 820, clientY: 120 };
  const before = screenToSlide(engine.getCamera(), container.rect, at.clientX, at.clientY);
  engine.zoomBy(2, at);
  runFrames(frames, clock);
  const after = screenToSlide(engine.getCamera(), container.rect, at.clientX, at.clientY);
  assert.equal(engine.getCamera().zoom, -1);
  assert.ok(Math.abs(after.x - before.x) < 1e-6);
  assert.ok(Math.abs(after.y - before.y) < 1e-6);
});

test("objective presets zoom to the slide's magnification about the viewport centre", async () => {
  const { engine, container, frames, clock } = setup();
  engine.mount(container);
  assert.equal(engine.zoomToMagnification(10), false);
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  const centre = engine.getCamera();
  assert.equal(engine.zoomToMagnification(10), true);
  runFrames(frames, clock);
  assert.deepEqual(engine.getCamera(), { x: centre.x, y: centre.y, zoom: -2 });
  assert.equal(engine.zoomToMagnification(40, undefined, { animate: false }), true);
  assert.equal(engine.getCamera().zoom, 0);
  assert.equal(engine.zoomToMagnification(0), false);
});

test("reduced motion turns flights and eased zooms into cuts", async () => {
  const { engine, container, frames } = setup(true);
  engine.mount(container);
  const end = engine.flyTo({ x: 9000, y: 9000, zoom: -1 });
  assert.deepEqual(engine.getCamera(), { x: 9000, y: 9000, zoom: -1 });
  assert.equal(await end, "arrived");
  engine.zoomBy(1);
  assert.equal(engine.getCamera().zoom, 0);
  frames.flush();
  assert.equal(frames.pending.size, 0);
});

test("a detached engine flies by jumping to the target", async () => {
  const { engine } = setup();
  assert.equal(await engine.flyTo({ x: 7, y: 8, zoom: 1 }), "arrived");
  assert.deepEqual(engine.getCamera(), { x: 7, y: 8, zoom: 1 });
});

test("unmounting mid-flight lands on the target and disposing cancels", async () => {
  const landed = setup();
  landed.engine.mount(landed.container);
  const arrive = landed.engine.flyTo({ x: 9000, y: 0, zoom: 1 });
  landed.clock.advance(16);
  landed.frames.flush();
  landed.engine.unmount();
  assert.equal(await arrive, "arrived");
  assert.deepEqual(landed.engine.getCamera(), { x: 9000, y: 0, zoom: 1 });
  assert.equal(landed.frames.pending.size, 0);

  const gone = setup();
  gone.engine.mount(gone.container);
  const cancelled = gone.engine.flyTo({ x: 9000, y: 0, zoom: 1 });
  gone.engine.dispose();
  assert.equal(await cancelled, "cancelled");
  assert.equal(gone.frames.pending.size, 0);
  assert.throws(() => gone.engine.flyTo({ x: 0, y: 0, zoom: 0 }), EngineDisposedError);
  assert.throws(() => gone.engine.panBy(1, 1), EngineDisposedError);
});
