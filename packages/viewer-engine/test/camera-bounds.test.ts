import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  type CameraBounds,
  cameraBounds,
  clampCamera,
  createCameraController,
  createViewerEngine,
  defaultZoomLimits,
  type EngineSlide,
} from "../src/index.ts";
import {
  FakeClock,
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  fakeSlide,
  runFrames,
} from "./engine-fakes.ts";

const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test("the zoom range runs from half the fitted size to 16 device pixels per slide pixel", () => {
  const cases = [
    { slide: { width: 40_000, height: 30_000 }, viewport: { width: 800, height: 600 }, ratio: 1 },
    { slide: { width: 100_000, height: 20_000 }, viewport: { width: 800, height: 600 }, ratio: 2 },
    { slide: { width: 2000, height: 9000 }, viewport: { width: 1600, height: 900 }, ratio: 1 },
    { slide: { width: 200_000, height: 200_000 }, viewport: { width: 375, height: 667 }, ratio: 3 },
  ];
  for (const { slide, viewport, ratio } of cases) {
    const bounds = cameraBounds({ slide, viewport, devicePixelRatio: ratio });
    const fitted = Math.min(viewport.width / slide.width, viewport.height / slide.height);
    close(2 ** bounds.minZoom, fitted / 2);
    close(2 ** bounds.maxZoom * ratio, 16);
    assert.deepEqual(bounds.extent, slide);
  }
});

test("a slide too small to zoom out on has one zoom, the deepest", () => {
  const bounds = cameraBounds({
    slide: { width: 1, height: 1 },
    viewport: { width: 800, height: 600 },
    devicePixelRatio: 1,
  });
  assert.equal(bounds.minZoom, 4);
  assert.equal(bounds.maxZoom, 4);
});

test("without a viewport the zoom range keeps its floor, and without a slide the defaults apply", () => {
  const slide = { width: 40_000, height: 30_000 };
  for (const viewport of [null, { width: 0, height: 0 }, { width: 800, height: 0 }]) {
    const bounds = cameraBounds({ slide, viewport, devicePixelRatio: 1 });
    assert.equal(bounds.minZoom, defaultZoomLimits.minZoom);
    assert.equal(bounds.maxZoom, 4);
  }
  assert.equal(
    cameraBounds({ slide: null, viewport: null, devicePixelRatio: 2 }),
    defaultZoomLimits,
  );
  for (const ratio of [0, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    const bounds = cameraBounds({ slide, viewport: null, devicePixelRatio: ratio });
    assert.equal(bounds.maxZoom, 4);
  }
});

test("a caller's zoom limits narrow the slide's range", () => {
  const bounds = cameraBounds({
    slide: { width: 40_000, height: 30_000 },
    viewport: { width: 800, height: 600 },
    devicePixelRatio: 1,
    cap: { minZoom: -5, maxZoom: 2 },
  });
  assert.equal(bounds.minZoom, -5);
  assert.equal(bounds.maxZoom, 2);
});

test("clamping keeps the view centre on the slide", () => {
  const bounds: CameraBounds = { minZoom: -8, maxZoom: 4, extent: { width: 1000, height: 500 } };
  assert.deepEqual(clampCamera({ x: -10, y: 600, zoom: 0 }, bounds), { x: 0, y: 500, zoom: 0 });
  assert.deepEqual(clampCamera({ x: 2000, y: -1, zoom: 9 }, bounds), { x: 1000, y: 0, zoom: 4 });
  const inside = { x: 500, y: 250, zoom: 0 };
  assert.equal(clampCamera(inside, bounds), inside);
});

function slideHost(start: Camera, extent = { width: 10_000, height: 8000 }) {
  const bounds: CameraBounds = { minZoom: -6, maxZoom: 4, extent };
  const clock = { time: 0 };
  let camera = start;
  const controller = createCameraController({
    bounds: () => bounds,
    now: () => clock.time,
    getCamera: () => camera,
    applyCamera: (next) => {
      camera = clampCamera(next, bounds);
    },
    viewport: () => ({ width: 800, height: 600 }),
    requestFrame: () => {},
    animates: () => true,
  });
  const throwBy = (dx: number, dy: number) => {
    controller.startDrag(400, 300);
    for (let sample = 1; sample <= 5; sample += 1) {
      clock.time += 10;
      controller.dragTo(400 + (dx * sample) / 5, 300 + (dy * sample) / 5);
    }
    controller.endDrag();
  };
  const run = () => {
    const seen: Camera[] = [];
    let frames = 0;
    while (controller.motion() !== "idle") {
      if (frames > 1000) throw new Error("Still coasting");
      clock.time += 16;
      controller.step();
      seen.push(camera);
      frames += 1;
    }
    return { seen, frames };
  };
  return { controller, camera: () => camera, throwBy, run };
}

test("a throw past each edge stops the camera at that edge", () => {
  const edges = [
    { name: "left", dx: 200, dy: 0, axis: "x", value: 0 },
    { name: "right", dx: -200, dy: 0, axis: "x", value: 10_000 },
    { name: "top", dx: 0, dy: 200, axis: "y", value: 0 },
    { name: "bottom", dx: 0, dy: -200, axis: "y", value: 8000 },
  ] as const;
  for (const edge of edges) {
    const near = { x: 5000 + Math.sign(-edge.dx) * 4700, y: 4000 + Math.sign(-edge.dy) * 3700 };
    const { camera, throwBy, run } = slideHost({ ...near, zoom: 0 });
    throwBy(edge.dx, edge.dy);
    const { seen } = run();
    assert.equal(camera()[edge.axis], edge.value, edge.name);
    for (const step of seen) {
      assert.ok(step.x >= 0 && step.x <= 10_000 && step.y >= 0 && step.y <= 8000, edge.name);
    }
    const atWall = seen.findIndex((step) => step[edge.axis] === edge.value);
    assert.ok(atWall >= 0, edge.name);
    assert.equal(atWall, seen.length - 1, `${edge.name} stops on the frame it reaches the edge`);
  }
});

test("a coast that hits one edge stops on that axis and keeps going on the other", () => {
  const { camera, throwBy, run } = slideHost({ x: 9900, y: 4000, zoom: 0 });
  throwBy(-200, -200);
  const { seen } = run();
  assert.equal(camera().x, 10_000);
  const hit = seen.findIndex((step) => step.x === 10_000);
  assert.ok(hit >= 0 && hit < seen.length - 1);
  for (const step of seen.slice(hit)) assert.equal(step.x, 10_000);
  assert.ok(camera().y > (seen[hit]?.y ?? 0) + 50);
});

test("a throw into a corner the camera already touches does not coast at all", () => {
  const { camera, controller, throwBy, run } = slideHost({ x: 10_000, y: 8000, zoom: 0 });
  throwBy(-200, -200);
  assert.deepEqual(camera(), { x: 10_000, y: 8000, zoom: 0 });
  assert.equal(controller.motion(), "idle");
  assert.equal(run().frames, 0);
});

test("a throw along a wall the camera touches coasts only along it", () => {
  const { camera, controller, throwBy, run } = slideHost({ x: 10_000, y: 4000, zoom: 0 });
  throwBy(-200, 100);
  assert.equal(controller.motion(), "coasting");
  const { seen } = run();
  for (const step of seen) assert.equal(step.x, 10_000);
  assert.ok(camera().y < 4000 - 100 - 50);
});

function engineSetup(width = 40_000, height = 30_000, ratio = 1) {
  const renderer = new FakeRenderer();
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const resize = new FakeResize();
  const container = new FakeContainer();
  let slides = 0;
  const sizes: Array<readonly [number, number]> = [[width, height]];
  const engine = createViewerEngine<EngineSlide>({
    createRenderer: renderer.create,
    openSlide: (ref) => {
      const [w, h] = sizes[Math.min(slides, sizes.length - 1)] ?? [width, height];
      slides += 1;
      return Promise.resolve(fakeSlide(ref.id, w, h));
    },
    frames,
    now: clock.now,
    reducedMotion: () => false,
    devicePixelRatio: () => ratio,
    observeResize: resize.observe,
  });
  return { engine, frames, clock, resize, container, sizes };
}

test("the engine applies the slide's zoom range and keeps the centre on the slide", async () => {
  const { engine, container, frames, clock } = engineSetup(40_000, 30_000, 2);
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  const bounds = engine.getCameraBounds();
  close(bounds.minZoom, Math.log2(800 / 40_000) - 1);
  close(bounds.maxZoom, 3);
  engine.zoomBy(-10, undefined, { animate: false });
  close(engine.getCamera().zoom, bounds.minZoom);
  engine.zoomBy(20);
  runFrames(frames, clock);
  assert.equal(engine.getCamera().zoom, 3);
  engine.setCamera({ x: -500, y: 90_000, zoom: 0 });
  assert.deepEqual(engine.getCamera(), { x: 0, y: 30_000, zoom: 0 });
  engine.panBy(10_000, 0);
  assert.equal(engine.getCamera().x, 0);
});

test("a resize re-clamps the camera to the new zoom range", async () => {
  const { engine, container, resize, frames, clock } = engineSetup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  engine.zoomBy(-10, undefined, { animate: false });
  const before = engine.getCameraBounds().minZoom;
  close(engine.getCamera().zoom, before);
  container.rect = { left: 100, top: 50, width: 3200, height: 2400 };
  resize.fire(container);
  const after = engine.getCameraBounds().minZoom;
  close(after, before + 2);
  close(engine.getCamera().zoom, after);
  runFrames(frames, clock);
  assert.equal(frames.pending.size, 0);
});

test("a resize during an eased zoom ends it on the new limit without drifting", async () => {
  const { engine, container, resize, frames, clock } = engineSetup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  const start = engine.getCamera();
  engine.zoomBy(-3);
  clock.advance(16);
  frames.flush();
  container.rect = { left: 100, top: 50, width: 3200, height: 2400 };
  resize.fire(container);
  runFrames(frames, clock);
  const end = engine.getCamera();
  close(end.zoom, engine.getCameraBounds().minZoom);
  assert.equal(end.x, start.x);
  assert.equal(end.y, start.y);
  assert.equal(engine.getMotion(), "idle");
});

test("switching slides re-clamps the camera to the new slide", async () => {
  const { engine, container, sizes, frames, clock } = engineSetup();
  sizes.push([1000, 800]);
  engine.mount(container);
  await engine.openSlide({ id: "big" });
  engine.setCamera({ x: 39_000, y: 29_000, zoom: 1 });
  await engine.openSlide({ id: "small" });
  const camera = engine.getCamera();
  const bounds = engine.getCameraBounds();
  assert.deepEqual(bounds.extent, { width: 1000, height: 800 });
  assert.ok(camera.x >= 0 && camera.x <= 1000 && camera.y >= 0 && camera.y <= 800);
  assert.ok(camera.zoom >= bounds.minZoom && camera.zoom <= bounds.maxZoom);
  engine.closeSlide();
  assert.equal(engine.getCameraBounds(), defaultZoomLimits);
  runFrames(frames, clock);
  assert.equal(frames.pending.size, 0);
});
