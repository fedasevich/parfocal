import assert from "node:assert/strict";
import { test } from "node:test";
import { type Camera, createViewerEngine } from "../src/index.ts";
import {
  FakeClock,
  FakeContainer,
  FakeFrames,
  FakeRenderer,
  FakeResize,
  FakeSource,
  runFrames,
} from "./engine-fakes.ts";
import { FakeTasks, FakeTimers, FakeVisibility } from "./scheduling-fakes.ts";

async function setup(options: { watchdog?: boolean } = {}) {
  const renderer = new FakeRenderer();
  const source = new FakeSource();
  const frames = new FakeFrames();
  const clock = new FakeClock();
  const resize = new FakeResize();
  const container = new FakeContainer();
  const visibility = new FakeVisibility();
  const timers = new FakeTimers();
  const tasks = new FakeTasks();
  const engine = createViewerEngine({
    createRenderer: renderer.create,
    openSlide: source.open,
    zoomLimits: { minZoom: -10, maxZoom: 2 },
    frames,
    now: clock.now,
    reducedMotion: () => false,
    observeResize: resize.observe,
    scheduling: {
      visibility,
      tasks,
      ...(options.watchdog ? { timers } : {}),
    },
  });
  engine.mount(container);
  await engine.openSlide({ id: "a" });
  runFrames(frames, clock);
  return { engine, renderer, frames, clock, container, visibility, timers, tasks };
}

const target: Camera = { x: 20_000, y: 5000, zoom: -3 };

test("an idle engine holds no frame, task or timer", async () => {
  const { frames, tasks, timers } = await setup({ watchdog: true });
  assert.equal(frames.pending.size, 0);
  assert.equal(tasks.pending.size, 0);
  assert.equal(timers.pending.size, 0);
});

test("a flight running when the tab is hidden lands on its target at once", async () => {
  const { engine, frames, clock, visibility, renderer } = await setup();
  const seen: Camera[] = [];
  engine.subscribeCamera(() => seen.push(engine.getCamera()));
  const end = engine.flyTo(target);
  clock.advance(100);
  frames.flush();
  assert.equal(engine.getMotion(), "flying");
  visibility.set(true);
  assert.equal(await end, "arrived");
  assert.deepEqual(engine.getCamera(), target);
  assert.deepEqual(renderer.last().camera, target);
  assert.deepEqual(seen.at(-1), target);
  assert.equal(engine.getMotion(), "idle");
});

test("a flight started in a hidden tab arrives without a single animation frame", async () => {
  const { engine, frames, tasks, visibility } = await setup();
  visibility.set(true);
  const seen: Camera[] = [];
  engine.subscribeCamera(() => seen.push(engine.getCamera()));
  const end = engine.flyTo(target);
  assert.equal(await end, "arrived");
  assert.deepEqual(engine.getCamera(), target);
  assert.equal(frames.pending.size, 0);
  assert.equal(engine.getMotion(), "idle");
  tasks.flush();
  assert.deepEqual(seen.at(-1), target);
  assert.equal(seen.length, 1);
});

test("an eased zoom running when the tab is hidden ends on its target", async () => {
  const { engine, frames, clock, visibility } = await setup();
  const zoom = engine.getCamera().zoom + 1;
  engine.zoomTo(zoom);
  clock.advance(20);
  frames.flush();
  assert.equal(engine.getMotion(), "zooming");
  visibility.set(true);
  assert.equal(engine.getCamera().zoom, zoom);
  assert.equal(engine.getMotion(), "idle");
});

test("a zoom started in a hidden tab applies at once", async () => {
  const { engine, visibility, frames } = await setup();
  visibility.set(true);
  const zoom = engine.getCamera().zoom + 1;
  engine.zoomTo(zoom);
  assert.equal(engine.getCamera().zoom, zoom);
  assert.equal(engine.getMotion(), "idle");
  assert.equal(frames.pending.size, 0);
});

test("a throw released in a hidden tab does not coast", async () => {
  const { engine, clock, visibility, frames } = await setup();
  const before = engine.getCamera();
  visibility.set(true);
  engine.startDrag({ clientX: 400, clientY: 300 });
  for (let step = 1; step <= 5; step++) {
    clock.advance(8);
    engine.dragTo({ clientX: 400 + step * 30, clientY: 300 });
  }
  engine.endDrag();
  assert.equal(engine.getMotion(), "idle");
  assert.equal(frames.pending.size, 0);
  assert.notEqual(engine.getCamera().x, before.x);
});

test("a coast running when the tab is hidden ends where it would have ended", async () => {
  const visible = await setup();
  const hidden = await setup();
  for (const rig of [visible, hidden]) {
    rig.engine.startDrag({ clientX: 400, clientY: 300 });
    for (let step = 1; step <= 5; step++) {
      rig.clock.advance(8);
      rig.engine.dragTo({ clientX: 400 + step * 30, clientY: 300 });
    }
    rig.engine.endDrag();
    assert.equal(rig.engine.getMotion(), "coasting");
  }
  runFrames(visible.frames, visible.clock, 4, 5000);
  hidden.visibility.set(true);
  assert.equal(hidden.engine.getMotion(), "idle");
  const walked = visible.engine.getCamera();
  const jumped = hidden.engine.getCamera();
  assert.ok(Math.abs(walked.x - jumped.x) < 1, `${walked.x} against ${jumped.x}`);
  assert.equal(walked.zoom, jumped.zoom);
});

test("a camera change in a hidden tab still reaches subscribers, through a task", async () => {
  const { engine, visibility, frames, tasks } = await setup();
  visibility.set(true);
  let notified = 0;
  engine.subscribeCamera(() => {
    notified += 1;
  });
  engine.panBy(-50, 0);
  assert.equal(frames.pending.size, 0);
  assert.equal(tasks.pending.size, 1);
  tasks.flush();
  assert.equal(notified, 1);
});

test("a frame lost while the tab was hidden is replaced when it comes back", async () => {
  const { engine, frames, clock, visibility } = await setup();
  let notified = 0;
  engine.subscribeCamera(() => {
    notified += 1;
  });
  engine.panBy(-50, 0);
  assert.equal(frames.pending.size, 1);
  frames.pending.clear();
  visibility.set(true);
  visibility.set(false);
  assert.equal(frames.pending.size, 1);
  clock.advance(16);
  frames.flush();
  assert.equal(notified, 1);
});

test("the watchdog delivers a camera change when animation frames never arrive", async () => {
  const { engine, frames, timers } = await setup({ watchdog: true });
  let notified = 0;
  engine.subscribeCamera(() => {
    notified += 1;
  });
  engine.panBy(-50, 0);
  assert.equal(timers.pending.size, 1);
  frames.pending.clear();
  timers.fire();
  assert.equal(notified, 1);
  assert.equal(timers.pending.size, 0);
});

test("a running frame loop finishes with no timer left, so idle stays at zero", async () => {
  const { engine, frames, clock, timers, tasks } = await setup({ watchdog: true });
  const end = engine.flyTo(target);
  while (frames.pending.size > 0) {
    clock.advance(16);
    frames.flush();
  }
  assert.equal(await end, "arrived");
  assert.equal(frames.pending.size, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(tasks.pending.size, 0);
});

test("unmounting stops listening to the tab", async () => {
  const { engine, visibility } = await setup();
  assert.equal(visibility.listeners.size, 1);
  engine.unmount();
  assert.equal(visibility.listeners.size, 0);
});
