import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRendererSwitcher,
  createViewerEngine,
  EngineDisposedError,
  type RendererFactory,
  RendererRouteUnavailableError,
} from "../src/index.ts";
import {
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  type FakeRoute,
  type FakeSlide,
  FakeSource,
} from "./engine-fakes.ts";

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

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("switching the renderer keeps the camera, slide, overlays and brightness", async () => {
  const { engine, renderer, container, frames } = setup();
  const alternate = new FakeRenderer();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  engine.registerOverlay({ id: "results", order: 1 });
  engine.setSlideBrightness(140);
  engine.setCamera({ x: 12_000, y: 9_000, zoom: -1 });
  frames.flush();
  const camera = engine.getCamera();
  const first = renderer.last();

  engine.switchRenderer(alternate.create);

  const second = alternate.last();
  assert.deepEqual(engine.getCamera(), camera);
  assert.deepEqual(second.camera, camera);
  assert.equal(second.container, container);
  assert.equal(second.slide?.id, "a");
  assert.equal(second.slide?.closed, false);
  assert.deepEqual(
    second.overlays.map((overlay) => overlay.id),
    ["results"],
  );
  assert.deepEqual(second.brightness, [first.brightness.at(-1)]);
  assert.equal(engine.status(), "mounted");
});

test("the old route is destroyed once, before the new one is created", () => {
  const { engine, renderer, container } = setup();
  engine.mount(container);
  const first = renderer.last();
  let destroyedBeforeCreate: boolean | null = null;
  let destroyCalls = 0;
  const destroy = first.destroy.bind(first);
  first.destroy = () => {
    destroyCalls += 1;
    destroy();
  };
  const alternate = new FakeRenderer();
  engine.switchRenderer((host) => {
    destroyedBeforeCreate = first.destroyed;
    return alternate.create(host);
  });
  assert.equal(destroyedBeforeCreate, true);
  assert.equal(destroyCalls, 1);
  assert.equal(alternate.alive().length, 1);
  engine.unmount();
  assert.equal(destroyCalls, 1);
  assert.equal(alternate.alive().length, 0);
});

test("after a switch every later change reaches only the new route", async () => {
  const { engine, renderer, container, frames } = setup();
  const alternate = new FakeRenderer();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  frames.flush();
  const first = renderer.last();
  const callsBefore = first.cameraCalls;
  engine.switchRenderer(alternate.create);
  engine.panBy(500, 0);
  frames.flush();
  engine.setSlideBrightness(80);
  await engine.openSlide({ id: "b" });
  assert.equal(first.cameraCalls, callsBefore);
  assert.equal(first.slide?.id, "a");
  assert.deepEqual(alternate.last().camera, engine.getCamera());
  assert.equal(alternate.last().slide?.id, "b");
  assert.equal(alternate.last().brightness.length, 2);
});

test("switching does not refit a camera the user moved", async () => {
  const { engine, container, frames, resize } = setup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  frames.flush();
  engine.setCamera({ x: 5_000, y: 5_000, zoom: 0 });
  frames.flush();
  const camera = engine.getCamera();
  for (let round = 0; round < 10; round++) {
    engine.switchRenderer(new FakeRenderer().create);
    resize.fire(container);
    frames.flush();
  }
  assert.deepEqual(engine.getCamera(), camera);
  assert.equal(container.listenerCount() > 0, true);
});

test("ten switches leave one live route and the same listeners", async () => {
  const { engine, renderer, container } = setup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  const listeners = container.listenerCount();
  const renderers = [renderer];
  for (let round = 0; round < 10; round++) {
    const next = new FakeRenderer();
    renderers.push(next);
    engine.switchRenderer(next.create);
  }
  const alive = renderers.flatMap((each) => each.alive());
  assert.equal(alive.length, 1);
  assert.equal(alive[0], renderers.at(-1)?.last());
  assert.equal(container.listenerCount(), listeners);
});

test("a switch while detached is used by the next mount", () => {
  const { engine, renderer, container } = setup();
  const alternate = new FakeRenderer();
  engine.switchRenderer(alternate.create);
  assert.equal(renderer.routes.length, 0);
  assert.equal(alternate.routes.length, 0);
  engine.mount(container);
  assert.equal(renderer.routes.length, 0);
  assert.equal(alternate.routes.length, 1);
});

test("a route that fails to start leaves the previous route working", async () => {
  const { engine, renderer, container } = setup();
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  engine.setCamera({ x: 7_000, y: 6_000, zoom: -2 });
  const camera = engine.getCamera();
  const failing: RendererFactory<FakeSlide> = () => {
    throw new Error("WebGPU is not available");
  };
  assert.throws(() => engine.switchRenderer(failing), /WebGPU is not available/);
  assert.equal(renderer.routes.length, 2);
  assert.equal(renderer.alive().length, 1);
  assert.equal(renderer.last().slide?.id, "a");
  assert.deepEqual(renderer.last().camera, camera);
  engine.unmount();
  engine.mount(container);
  assert.equal(renderer.routes.length, 3);
});

test("a disposed engine refuses to switch", () => {
  const { engine } = setup();
  engine.dispose();
  assert.throws(() => engine.switchRenderer(new FakeRenderer().create), EngineDisposedError);
});

test("the engine waits for the mounted route to go idle", async () => {
  const { engine, renderer, container } = setup();
  await engine.whenIdle();
  engine.mount(container);
  const gate = deferred<void>();
  let waits = 0;
  const route: FakeRoute = renderer.last();
  route.whenIdle = () => {
    waits += 1;
    return gate.promise;
  };
  let idle = false;
  const waiting = engine.whenIdle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);
  gate.resolve();
  await waiting;
  assert.equal(waits, 1);
});

test("the switcher loads a route once it is asked for and reports the current one", async () => {
  const { engine, renderer, container } = setup();
  const alternate = new FakeRenderer();
  let loads = 0;
  const switcher = createRendererSwitcher({
    engine,
    routes: {
      viv: () => renderer.create,
      "deck-webgpu": () => {
        loads += 1;
        return Promise.resolve(alternate.create);
      },
    },
  });
  engine.mount(container);
  assert.equal(switcher.current(), "viv");
  assert.deepEqual(switcher.available(), ["viv", "deck-webgpu"]);
  assert.equal(loads, 0);
  assert.equal(await switcher.switchTo("viv"), "unchanged");
  assert.equal(await switcher.switchTo("deck-webgpu"), "switched");
  assert.equal(switcher.current(), "deck-webgpu");
  assert.equal(loads, 1);
  assert.equal(renderer.alive().length, 0);
  assert.equal(alternate.alive().length, 1);
  assert.equal(await switcher.switchTo("viv"), "switched");
  assert.equal(renderer.alive().length, 1);
  assert.equal(alternate.alive().length, 0);
});

test("the switcher refuses a route nobody registered", async () => {
  const { engine, renderer } = setup();
  const switcher = createRendererSwitcher({ engine, routes: { viv: () => renderer.create } });
  await assert.rejects(switcher.switchTo("custom-webgpu"), RendererRouteUnavailableError);
  assert.equal(switcher.current(), "viv");
});

test("a slow route load is dropped when a later switch overtakes it", async () => {
  const { engine, renderer, container } = setup();
  const slow = new FakeRenderer();
  const fast = new FakeRenderer();
  const gate = deferred<RendererFactory<FakeSlide>>();
  const switcher = createRendererSwitcher({
    engine,
    routes: {
      viv: () => renderer.create,
      "deck-webgpu": () => gate.promise,
      "custom-webgpu": () => fast.create,
    },
  });
  engine.mount(container);
  const first = switcher.switchTo("deck-webgpu");
  assert.equal(await switcher.switchTo("custom-webgpu"), "switched");
  gate.resolve(slow.create);
  assert.equal(await first, "superseded");
  assert.equal(switcher.current(), "custom-webgpu");
  assert.equal(slow.routes.length, 0);
  assert.equal(fast.alive().length, 1);
});

test("asking for the current route again cancels a load in flight", async () => {
  const { engine, renderer, container } = setup();
  const slow = new FakeRenderer();
  const gate = deferred<RendererFactory<FakeSlide>>();
  const switcher = createRendererSwitcher({
    engine,
    routes: { viv: () => renderer.create, "deck-webgpu": () => gate.promise },
  });
  engine.mount(container);
  const first = switcher.switchTo("deck-webgpu");
  assert.equal(await switcher.switchTo("viv"), "unchanged");
  gate.resolve(slow.create);
  assert.equal(await first, "superseded");
  assert.equal(slow.routes.length, 0);
  assert.equal(renderer.alive().length, 1);
});

test("a route that loads after the engine is disposed is dropped", async () => {
  const { engine, renderer, container } = setup();
  const late = new FakeRenderer();
  const gate = deferred<RendererFactory<FakeSlide>>();
  const switcher = createRendererSwitcher({
    engine,
    routes: { viv: () => renderer.create, "deck-webgpu": () => gate.promise },
  });
  engine.mount(container);
  const pending = switcher.switchTo("deck-webgpu");
  engine.dispose();
  gate.resolve(late.create);
  assert.equal(await pending, "superseded");
  assert.equal(late.routes.length, 0);
});

test("a route whose load or start fails keeps the current route", async () => {
  const { engine, renderer, container } = setup();
  const switcher = createRendererSwitcher({
    engine,
    routes: {
      viv: () => renderer.create,
      "deck-webgpu": () => Promise.reject(new Error("The chunk did not load")),
      "custom-webgpu": () => () => {
        throw new Error("No adapter");
      },
    },
  });
  engine.mount(container);
  await assert.rejects(switcher.switchTo("deck-webgpu"), /chunk did not load/);
  await assert.rejects(switcher.switchTo("custom-webgpu"), /No adapter/);
  assert.equal(switcher.current(), "viv");
  assert.equal(renderer.alive().length, 1);
});
