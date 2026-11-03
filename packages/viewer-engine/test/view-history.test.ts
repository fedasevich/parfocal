import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindViewHistory,
  type Camera,
  createViewerEngine,
  createViewHistory,
  type RestTimers,
  viewHistoryLimit,
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

const view = (x: number, y = 0, zoom = -2): Camera => ({ x, y, zoom });

test("settling in a new place records the view that was left", () => {
  const history = createViewHistory();
  history.settle(view(0));
  history.settle(view(1000));
  history.settle(view(5000));
  assert.deepEqual(history.entries(), {
    back: [view(0), view(1000)],
    forward: [],
    rest: view(5000),
  });
});

test("settling where the camera already rests records nothing", () => {
  const history = createViewHistory();
  history.settle(view(0));
  history.settle(view(1));
  history.settle({ x: 0, y: 0, zoom: -2.005 });
  assert.deepEqual(history.entries().back, []);
});

test("back and forward walk the views and a new move drops the forward views", () => {
  const history = createViewHistory();
  history.settle(view(0));
  history.settle(view(1000));
  history.settle(view(2000));
  assert.deepEqual(history.back(view(2000)), view(1000));
  assert.deepEqual(history.back(), view(0));
  assert.equal(history.back(), null);
  assert.deepEqual(history.forward(view(0)), view(1000));
  assert.deepEqual(history.entries(), {
    back: [view(0)],
    forward: [view(2000)],
    rest: view(1000),
  });
  history.settle(view(9000));
  assert.deepEqual(history.entries(), {
    back: [view(0), view(1000)],
    forward: [],
    rest: view(9000),
  });
  assert.equal(history.forward(view(9000)), null);
});

test("going back from an unsettled camera keeps that camera to go forward to", () => {
  const history = createViewHistory();
  history.settle(view(0));
  assert.deepEqual(history.back(view(3000)), view(0));
  assert.deepEqual(history.forward(), view(3000));
});

test("the history keeps the last fifty views", () => {
  const history = createViewHistory();
  for (let index = 0; index <= viewHistoryLimit + 10; index++) history.settle(view(index * 1000));
  const { back } = history.entries();
  assert.equal(back.length, viewHistoryLimit);
  assert.deepEqual(back[0], view(10_000));
  assert.deepEqual(back.at(-1), view(viewHistoryLimit * 1000 + 9000));
});

class FakeTimers implements RestTimers {
  private next = 1;
  readonly pending = new Map<number, { callback: () => void; due: number }>();
  private readonly clock: FakeClock;
  constructor(clock: FakeClock) {
    this.clock = clock;
  }
  readonly set = (callback: () => void, ms: number) => {
    const handle = this.next++;
    this.pending.set(handle, { callback, due: this.clock.time + ms });
    return handle;
  };
  readonly clear = (handle: unknown) => {
    this.pending.delete(handle as number);
  };
  run(): void {
    for (const [handle, timer] of [...this.pending]) {
      if (timer.due > this.clock.time) continue;
      this.pending.delete(handle);
      timer.callback();
    }
  }
}

function setup() {
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const source = new FakeSource();
  const renderer = new FakeRenderer();
  const engine = createViewerEngine({
    createRenderer: renderer.create,
    openSlide: source.open,
    zoomLimits: { minZoom: -10, maxZoom: 2 },
    frames,
    now: clock.now,
    reducedMotion: () => false,
    observeResize: new FakeResize().observe,
  });
  const timers = new FakeTimers(clock);
  engine.mount(new FakeContainer());
  const bound = bindViewHistory(engine, { timers });
  const rest = () => {
    runFrames(frames, clock);
    clock.advance(1000);
    timers.run();
  };
  return { engine, bound, rest, frames, clock, timers };
}

test("a pan of many steps counts as one entry once the camera rests", async () => {
  const { engine, bound, rest, clock, timers } = setup();
  await engine.openSlide({ id: "a" });
  rest();
  const fitted = engine.getCamera();
  for (let index = 0; index < 20; index++) {
    engine.panBy(10, 0);
    clock.advance(16);
    timers.run();
  }
  rest();
  assert.deepEqual(bound.history.entries().back, [fitted]);
  assert.deepEqual(bound.history.entries().rest, engine.getCamera());
});

test("back after a jump flies to the old view and forward returns", async () => {
  const { engine, bound, rest } = setup();
  await engine.openSlide({ id: "a" });
  rest();
  void engine.flyToArea({ x: 2000, y: 3000, width: 1600, height: 1200 });
  rest();
  const old = engine.getCamera();
  void engine.flyTo({ x: 30_000, y: 22_000, zoom: -1 });
  rest();
  const jumped = engine.getCamera();
  assert.equal(bound.back(), true);
  rest();
  assert.deepEqual(engine.getCamera(), old);
  assert.equal(bound.forward(), true);
  rest();
  assert.deepEqual(engine.getCamera(), jumped);
  assert.equal(bound.forward(), false);
  assert.equal(bound.history.entries().back.length, 2);
});

test("pressing back twice during a flight skips two views without recording the flight", async () => {
  const { engine, bound, rest, frames, clock } = setup();
  await engine.openSlide({ id: "a" });
  rest();
  const fitted = engine.getCamera();
  for (const x of [5000, 15_000, 25_000]) {
    void engine.flyTo({ x, y: 10_000, zoom: -1 });
    rest();
  }
  bound.back();
  clock.advance(16);
  frames.flush();
  bound.back();
  rest();
  assert.deepEqual(engine.getCamera(), { x: 5000, y: 10_000, zoom: -1 });
  assert.deepEqual(bound.history.entries().back, [fitted]);
  assert.equal(bound.history.entries().forward.length, 2);
});

test("switching slides clears the history", async () => {
  const { engine, bound, rest } = setup();
  await engine.openSlide({ id: "a" });
  rest();
  void engine.flyTo({ x: 9000, y: 9000, zoom: -1 });
  rest();
  assert.equal(bound.history.entries().back.length, 1);
  await engine.openSlide({ id: "b" });
  rest();
  assert.deepEqual(bound.history.entries().back, []);
  assert.equal(bound.back(), false);
  bound.dispose();
});

test("a zoom to the selection records the view it left, so back returns there", async () => {
  const { engine, bound, rest } = setup();
  await engine.openSlide({ id: "a" });
  rest();
  const fitted = engine.getCamera();
  void engine.flyToSelection({ x: 12_000, y: 9000, width: 700, height: 300 });
  rest();
  const selected = engine.getCamera();
  assert.notDeepEqual(selected, fitted);
  assert.deepEqual(bound.history.entries().back, [fitted]);
  assert.equal(bound.back(), true);
  rest();
  assert.deepEqual(engine.getCamera(), fitted);
});

test("a history of other views uses the sameness it is given", () => {
  type Spot = { object: string | null; z?: number };
  const history = createViewHistory<Spot>(2, (a, b) => a.object === b.object && a.z === b.z);
  history.settle({ object: null });
  history.settle({ object: null });
  history.settle({ object: "T1" });
  history.settle({ object: "T2" });
  history.settle({ object: "T3" });
  assert.deepEqual(history.entries().back, [{ object: "T1" }, { object: "T2" }]);
  assert.deepEqual(history.back({ object: "T3", z: 4 }), { object: "T3" });
  assert.deepEqual(history.forward(), { object: "T3", z: 4 });
});
