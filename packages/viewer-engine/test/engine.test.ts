import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createViewerEngine,
  EngineDisposedError,
  SlideOpenSupersededError,
  type SlidePointerEvent,
} from "../src/index.ts";
import { FakeContainer, FakeFrames, FakeRenderer, FakeResize, FakeSource } from "./engine-fakes.ts";

function setup() {
  const renderer = new FakeRenderer();
  const source = new FakeSource();
  const frames = new FakeFrames();
  const resize = new FakeResize();
  const container = new FakeContainer();
  const engine = createViewerEngine({
    createRenderer: renderer.create,
    openSlide: source.open,
    zoomLimits: { minZoom: -10, maxZoom: 2 },
    frames,
    observeResize: resize.observe,
  });
  return { engine, renderer, source, frames, resize, container };
}

test("mounting creates one route and hands it the current state", async () => {
  const { engine, renderer, container } = setup();
  await engine.openSlide({ id: "a" });
  engine.registerOverlay({ id: "results", order: 1 });
  engine.mount(container);
  const route = renderer.last();
  assert.equal(engine.status(), "mounted");
  assert.equal(renderer.routes.length, 1);
  assert.equal(route.container, container);
  assert.equal(route.slide?.id, "a");
  assert.deepEqual(route.camera, engine.getCamera());
  assert.deepEqual(
    route.overlays.map((overlay) => overlay.id),
    ["results"],
  );
});

test("mounting twice without unmounting is refused", () => {
  const { engine, container } = setup();
  engine.mount(container);
  assert.throws(() => engine.mount(new FakeContainer()), /already mounted/);
});

test("unmounting destroys the route and keeps the slide and camera", async () => {
  const { engine, renderer, container, source } = setup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  const camera = engine.getCamera();
  engine.unmount();
  engine.unmount();
  assert.equal(engine.status(), "detached");
  assert.equal(renderer.last().destroyed, true);
  assert.equal(engine.getSlide()?.id, "a");
  assert.equal(source.opened[0]?.closed, false);
  assert.equal(engine.getCamera(), camera);
});

test("opening a slide while mounted fits it to the viewport and announces it", async () => {
  const { engine, renderer, container } = setup();
  const announced: (string | null)[] = [];
  engine.on("slide", (slide) => announced.push(slide?.id ?? null));
  engine.mount(container);
  const info = await engine.openSlide({ id: "a" });
  assert.deepEqual(info, { id: "a", width: 40_000, height: 30_000, micronsPerPixel: 0.25 });
  assert.deepEqual(engine.getCamera(), { x: 20_000, y: 15_000, zoom: Math.log2(800 / 40_000) });
  assert.equal(renderer.last().slide?.id, "a");
  assert.deepEqual(announced, ["a"]);
});

test("a slide opened before mounting is fitted once a viewport exists", async () => {
  const { engine, container } = setup();
  await engine.openSlide({ id: "a" });
  assert.deepEqual(engine.getCamera(), { x: 20_000, y: 15_000, zoom: 0 });
  engine.mount(container);
  assert.equal(engine.getCamera().zoom, Math.log2(800 / 40_000));
});

test("a slide opened into a zero-size viewport is fitted on the first resize", async () => {
  const { engine, container, resize, frames } = setup();
  container.rect = { left: 0, top: 0, width: 0, height: 0 };
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  assert.equal(engine.getCamera().zoom, 0);
  frames.flush();
  container.rect = { left: 0, top: 0, width: 400, height: 300 };
  resize.fire(container);
  assert.equal(engine.getCamera().zoom, Math.log2(400 / 40_000));
});

test("opening a new slide closes the previous one", async () => {
  const { engine, source } = setup();
  await engine.openSlide({ id: "a" });
  await engine.openSlide({ id: "b" });
  assert.equal(source.opened[0]?.closed, true);
  assert.equal(source.opened[1]?.closed, false);
  assert.equal(engine.getSlide()?.id, "b");
});

test("a superseded open is aborted, rejected and its slide closed", async () => {
  const { engine, source } = setup();
  source.deferred = true;
  const first = engine.openSlide({ id: "a" });
  const second = engine.openSlide({ id: "b" });
  assert.equal(source.signals[0]?.aborted, true);
  assert.equal(source.signals[1]?.aborted, false);
  source.resolve("b");
  source.resolve("a");
  await assert.rejects(first, SlideOpenSupersededError);
  assert.equal((await second).id, "b");
  assert.equal(source.opened[0]?.closed, true);
  assert.equal(engine.getSlide()?.id, "b");
});

test("a failed open rejects and leaves the engine usable", async () => {
  const { engine, source } = setup();
  source.deferred = true;
  const failing = engine.openSlide({ id: "a" });
  source.reject("a", new Error("unreadable"));
  await assert.rejects(failing, /unreadable/);
  source.deferred = false;
  assert.equal((await engine.openSlide({ id: "b" })).id, "b");
});

test("closing the slide clears it from the route and announces null", async () => {
  const { engine, renderer, container, source } = setup();
  const announced: (string | null)[] = [];
  engine.on("slide", (slide) => announced.push(slide?.id ?? null));
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  engine.closeSlide();
  assert.equal(engine.getSlide(), null);
  assert.equal(renderer.last().slide, null);
  assert.equal(source.opened[0]?.closed, true);
  assert.deepEqual(announced, ["a", null]);
});

test("setting the camera reaches the route at once and clamps the zoom", () => {
  const { engine, renderer, container } = setup();
  engine.mount(container);
  engine.setCamera({ x: 10, y: 20, zoom: 7 });
  assert.deepEqual(renderer.last().camera, { x: 10, y: 20, zoom: 2 });
  assert.deepEqual(engine.getCamera(), { x: 10, y: 20, zoom: 2 });
});

test("camera subscribers hear once per frame however many times the camera moved", () => {
  const { engine, container, frames } = setup();
  engine.mount(container);
  let calls = 0;
  engine.subscribeCamera(() => {
    calls += 1;
  });
  for (let step = 1; step <= 10; step += 1) engine.setCamera({ x: step, y: 0, zoom: 0 });
  assert.equal(calls, 0);
  frames.flush();
  assert.equal(calls, 1);
  frames.flush();
  assert.equal(calls, 1);
});

test("the camera snapshot keeps its identity until it changes", () => {
  const { engine, container, renderer, frames } = setup();
  engine.mount(container);
  engine.setCamera({ x: 1, y: 2, zoom: 0 });
  const snapshot = engine.getCamera();
  const calls = renderer.last().cameraCalls;
  engine.setCamera({ x: 1, y: 2, zoom: 0 });
  frames.flush();
  assert.equal(engine.getCamera(), snapshot);
  assert.equal(renderer.last().cameraCalls, calls);
});

test("camera subscribers hear at once while detached and stop after unsubscribing", () => {
  const { engine } = setup();
  let calls = 0;
  const unsubscribe = engine.subscribeCamera(() => {
    calls += 1;
  });
  engine.setCamera({ x: 1, y: 0, zoom: 0 });
  assert.equal(calls, 1);
  unsubscribe();
  engine.setCamera({ x: 2, y: 0, zoom: 0 });
  assert.equal(calls, 1);
});

test("a camera change still pending at unmount is delivered", () => {
  const { engine, container } = setup();
  engine.mount(container);
  let calls = 0;
  engine.subscribeCamera(() => {
    calls += 1;
  });
  engine.setCamera({ x: 3, y: 0, zoom: 0 });
  engine.unmount();
  assert.equal(calls, 1);
});

test("pointer events carry slide coordinates and measure the container once per frame", () => {
  const { engine, container, frames } = setup();
  engine.mount(container);
  engine.setCamera({ x: 5000, y: 3000, zoom: -2 });
  frames.flush();
  const events: SlidePointerEvent[] = [];
  engine.on("pointer", (event) => events.push(event));
  const before = container.measurements;
  container.dispatch("pointermove", { clientX: 501, clientY: 352, buttons: 1, pointerId: 7 });
  container.dispatch("pointermove", { clientX: 500, clientY: 350, buttons: 1, pointerId: 7 });
  container.dispatch("wheel", { clientX: 500, clientY: 350, deltaY: -120, ctrlKey: true });
  assert.equal(container.measurements - before, 1);
  frames.flush();
  container.dispatch("pointerup", { clientX: 500, clientY: 350, pointerId: 7 });
  assert.equal(container.measurements - before, 2);
  assert.deepEqual(
    events.map((event) => [event.kind, event.slideX, event.slideY]),
    [
      ["move", 5004, 3008],
      ["move", 5000, 3000],
      ["wheel", 5000, 3000],
      ["up", 5000, 3000],
    ],
  );
  assert.equal(events[0]?.pointerId, 7);
  assert.equal(events[0]?.buttons, 1);
  assert.equal(events[2]?.deltaY, -120);
  assert.equal(events[2]?.ctrlKey, true);
});

test("pointer events are not measured when nobody listens", () => {
  const { engine, container } = setup();
  engine.mount(container);
  const before = container.measurements;
  container.dispatch("pointermove", { clientX: 1, clientY: 1 });
  assert.equal(container.measurements, before);
});

test("overlays are handed to the route in order and survive a remount", () => {
  const { engine, renderer, container } = setup();
  engine.mount(container);
  const results = engine.registerOverlay({ id: "results", order: 2 });
  engine.registerOverlay({ id: "drafts", order: 1 });
  assert.deepEqual(
    renderer.last().overlays.map((overlay) => overlay.id),
    ["drafts", "results"],
  );
  assert.throws(() => engine.registerOverlay({ id: "drafts", order: 3 }), /already registered/);
  results.invalidate();
  assert.deepEqual(renderer.last().invalidated, ["results"]);
  engine.unmount();
  engine.mount(container);
  assert.deepEqual(
    renderer.last().overlays.map((overlay) => overlay.id),
    ["drafts", "results"],
  );
  results.unregister();
  results.unregister();
  results.invalidate();
  assert.deepEqual(
    renderer.last().overlays.map((overlay) => overlay.id),
    ["drafts"],
  );
  assert.deepEqual(renderer.last().invalidated, []);
});

test("disposing closes the slide, destroys the route and refuses further use", async () => {
  const { engine, renderer, container, source } = setup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  engine.dispose();
  engine.dispose();
  assert.equal(engine.status(), "disposed");
  assert.equal(renderer.last().destroyed, true);
  assert.equal(source.opened[0]?.closed, true);
  assert.equal(engine.getSlide(), null);
  assert.throws(() => engine.mount(container), EngineDisposedError);
  assert.throws(() => engine.setCamera({ x: 0, y: 0, zoom: 0 }), EngineDisposedError);
  assert.throws(() => engine.subscribeCamera(() => {}), EngineDisposedError);
  assert.throws(() => engine.registerOverlay({ id: "x", order: 0 }), EngineDisposedError);
  await assert.rejects(engine.openSlide({ id: "b" }), EngineDisposedError);
});

test("a slide that finishes opening after dispose is closed", async () => {
  const { engine, source } = setup();
  source.deferred = true;
  const opening = engine.openSlide({ id: "a" });
  engine.dispose();
  assert.equal(source.signals[0]?.aborted, true);
  source.resolve("a");
  await assert.rejects(opening, EngineDisposedError);
  assert.equal(source.opened[0]?.closed, true);
});

test("a mount, unmount and remount cycle leaves no listeners, observers, frames or routes", async () => {
  const { engine, renderer, container, frames, resize } = setup();
  const otherContainer = new FakeContainer();
  await engine.openSlide({ id: "a" });

  engine.mount(container);
  const listenersWhenMounted = container.listenerCount();
  assert.ok(listenersWhenMounted > 0);
  assert.equal(resize.active.size, 1);
  engine.setCamera({ x: 1, y: 1, zoom: 0 });
  assert.ok(frames.pending.size > 0);

  engine.unmount();
  assert.equal(container.listenerCount(), 0);
  assert.equal(resize.active.size, 0);
  assert.equal(frames.pending.size, 0);
  assert.equal(renderer.alive().length, 0);

  for (let cycle = 0; cycle < 20; cycle += 1) {
    const target = cycle % 2 === 0 ? container : otherContainer;
    engine.mount(target);
    assert.equal(target.listenerCount(), listenersWhenMounted);
    assert.equal(renderer.alive().length, 1);
    engine.setCamera({ x: cycle, y: cycle, zoom: -1 });
    target.dispatch("pointermove", { clientX: 10, clientY: 10 });
    engine.unmount();
    assert.equal(target.listenerCount(), 0);
  }
  assert.equal(otherContainer.listenerCount(), 0);
  assert.equal(resize.active.size, 0);
  assert.equal(frames.pending.size, 0);
  assert.equal(renderer.alive().length, 0);
  assert.equal(renderer.routes.length, 21);

  engine.mount(container);
  engine.dispose();
  assert.equal(container.listenerCount(), 0);
  assert.equal(resize.active.size, 0);
  assert.equal(frames.pending.size, 0);
  assert.equal(renderer.alive().length, 0);
});
