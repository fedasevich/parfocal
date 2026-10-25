import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuardedFrames, type FrameScheduler } from "../src/index.ts";
import { FakeFrames } from "./engine-fakes.ts";
import { FakeTasks, FakeTimers, FakeVisibility } from "./scheduling-fakes.ts";

function setup(watchdog = true) {
  const frames = new FakeFrames();
  const timers = new FakeTimers();
  const tasks = new FakeTasks();
  const visibility = new FakeVisibility();
  const guarded = createGuardedFrames({
    frames,
    visibility,
    tasks,
    timers: watchdog ? timers : null,
    watchdogMs: 500,
  });
  return { frames, timers, tasks, visibility, guarded };
}

test("a frame request runs on the animation frame and leaves no timer or frame behind", () => {
  const { frames, timers, guarded } = setup();
  let runs = 0;
  guarded.request(() => {
    runs += 1;
  });
  assert.equal(frames.pending.size, 1);
  assert.equal(timers.pending.size, 1);
  frames.flush();
  assert.equal(runs, 1);
  assert.equal(frames.pending.size, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(guarded.pending(), 0);
  assert.deepEqual(guarded.stats(), { fromFrame: 1, fromWatchdog: 0, fromTask: 0, restarts: 0 });
});

test("the watchdog runs the callback when the animation frame never arrives", () => {
  const { frames, timers, guarded } = setup();
  let runs = 0;
  guarded.request(() => {
    runs += 1;
  });
  assert.equal([...timers.pending.values()][0]?.ms, 500);
  timers.fire();
  assert.equal(runs, 1);
  assert.equal(frames.pending.size, 0);
  frames.flush();
  assert.equal(runs, 1);
  assert.equal(guarded.stats().fromWatchdog, 1);
});

test("without timers the animation frame is the only way in", () => {
  const { frames, timers, guarded } = setup(false);
  guarded.request(() => {});
  assert.equal(timers.pending.size, 0);
  assert.equal(frames.pending.size, 1);
});

test("a hidden tab runs the callback as a task, with no frame and no timer", () => {
  const { frames, timers, tasks, visibility, guarded } = setup();
  visibility.setQuietly(true);
  let runs = 0;
  guarded.request(() => {
    runs += 1;
  });
  assert.equal(frames.pending.size, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(tasks.flush(), 1);
  assert.equal(runs, 1);
  assert.equal(guarded.stats().fromTask, 1);
});

test("a cancelled request never runs and clears its frame and timer", () => {
  const { frames, timers, guarded } = setup();
  let runs = 0;
  const handle = guarded.request(() => {
    runs += 1;
  });
  guarded.cancel(handle);
  assert.equal(frames.pending.size, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(guarded.pending(), 0);
  frames.flush();
  assert.equal(runs, 0);
});

test("restarting moves a request parked in a suspended frame onto a fresh one", () => {
  const { frames, timers, guarded } = setup();
  let runs = 0;
  guarded.request(() => {
    runs += 1;
  });
  frames.pending.clear();
  guarded.restart();
  assert.equal(frames.pending.size, 1);
  assert.equal(timers.pending.size, 1);
  frames.flush();
  assert.equal(runs, 1);
  assert.equal(guarded.stats().restarts, 1);
});

test("a stale frame callback that a scheduler fails to cancel is ignored after a restart", () => {
  const issued: Array<() => void> = [];
  const hostile: FrameScheduler = {
    request: (callback) => {
      issued.push(callback);
      return issued.length;
    },
    cancel: () => {},
  };
  const guarded = createGuardedFrames({
    frames: hostile,
    visibility: new FakeVisibility(),
    tasks: new FakeTasks(),
    timers: null,
    watchdogMs: 500,
  });
  let runs = 0;
  guarded.request(() => {
    runs += 1;
  });
  guarded.restart();
  issued[0]?.();
  assert.equal(runs, 0);
  issued[1]?.();
  assert.equal(runs, 1);
  issued[0]?.();
  assert.equal(runs, 1);
});

test("restarting while hidden turns frames into tasks, and showing the tab turns them back", () => {
  const { frames, tasks, visibility, guarded } = setup();
  let runs = 0;
  guarded.request(() => {
    runs += 1;
  });
  visibility.setQuietly(true);
  guarded.restart();
  assert.equal(frames.pending.size, 0);
  assert.equal(tasks.pending.size, 1);
  visibility.setQuietly(false);
  guarded.restart();
  assert.equal(tasks.pending.size, 0);
  assert.equal(frames.pending.size, 1);
  frames.flush();
  assert.equal(runs, 1);
});

test("a callback that requests again gets a new request of its own", () => {
  const { frames, guarded } = setup();
  let runs = 0;
  const again = () => {
    runs += 1;
    if (runs < 3) guarded.request(again);
  };
  guarded.request(again);
  frames.flush();
  frames.flush();
  frames.flush();
  assert.equal(runs, 3);
  assert.equal(guarded.pending(), 0);
});
