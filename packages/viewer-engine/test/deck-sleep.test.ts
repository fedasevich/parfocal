import assert from "node:assert/strict";
import { test } from "node:test";
import { createGuardedFrames } from "../src/index.ts";
import { createDeckSleep, defaultQuietFrames } from "../src/viv/deck-sleep.ts";
import { FakeFrames } from "./engine-fakes.ts";
import { FakeTasks, FakeTimers, FakeVisibility } from "./scheduling-fakes.ts";

function setup(quietFrames = defaultQuietFrames) {
  const frames = new FakeFrames();
  const timers = new FakeTimers();
  const tasks = new FakeTasks();
  const visibility = new FakeVisibility();
  const state = { settled: true, drawn: 0 };
  const guarded = createGuardedFrames({ frames, visibility, tasks, timers, watchdogMs: 500 });
  const sleep = createDeckSleep({
    frames: guarded,
    visibility,
    settled: () => state.settled,
    now: () => 0,
    quietFrames,
  });
  const loop = {
    id: null as number | null,
    step: () => {
      state.drawn += 1;
      loop.id = sleep.provider.requestAnimationFrame(loop.step);
    },
    start: () => {
      loop.id = sleep.provider.requestAnimationFrame(loop.step);
    },
    stop: () => {
      if (loop.id !== null) sleep.provider.cancelAnimationFrame(loop.id);
      loop.id = null;
    },
  };
  return { frames, timers, tasks, visibility, state, guarded, sleep, loop };
}

test("a loop with nothing to do draws a few quiet frames and then asks for no more", () => {
  const { frames, timers, sleep, loop, state } = setup(3);
  loop.start();
  for (let frame = 0; frame < 10; frame++) frames.flush();
  assert.equal(state.drawn, 3);
  assert.equal(sleep.asleep(), true);
  assert.equal(frames.pending.size, 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(sleep.stats().sleeps, 1);
});

test("a loop with work left keeps asking for frames", () => {
  const { frames, sleep, loop, state } = setup(3);
  state.settled = false;
  loop.start();
  for (let frame = 0; frame < 20; frame++) frames.flush();
  assert.equal(state.drawn, 20);
  assert.equal(sleep.asleep(), false);
});

test("waking a sleeping loop draws again and it goes back to sleep once quiet", () => {
  const { frames, sleep, loop, state } = setup(2);
  loop.start();
  for (let frame = 0; frame < 5; frame++) frames.flush();
  const asleepAt = state.drawn;
  sleep.wake("change");
  assert.equal(sleep.asleep(), false);
  assert.equal(frames.pending.size, 1);
  for (let frame = 0; frame < 5; frame++) frames.flush();
  assert.equal(state.drawn, asleepAt + 2);
  assert.equal(sleep.asleep(), true);
  assert.equal(sleep.stats().wakes.change, 1);
  assert.equal(sleep.stats().rescues, 0);
});

test("a wake while frames are running resets the quiet count", () => {
  const { frames, sleep, loop, state } = setup(3);
  loop.start();
  frames.flush();
  frames.flush();
  sleep.wake("read");
  frames.flush();
  frames.flush();
  assert.equal(sleep.asleep(), false);
  frames.flush();
  assert.equal(sleep.asleep(), true);
  assert.equal(state.drawn, 5);
});

test("waking a loop that is not asleep does not add a second frame", () => {
  const { frames, sleep, loop } = setup(3);
  loop.start();
  sleep.wake("resize");
  sleep.wake("resize");
  assert.equal(frames.pending.size, 1);
});

test("a wake from a poll while asleep counts as a rescue", () => {
  const { sleep, loop, frames } = setup(1);
  loop.start();
  frames.flush();
  assert.equal(sleep.asleep(), true);
  sleep.wake("poll");
  assert.equal(sleep.stats().rescues, 1);
});

test("stopping the loop drops the callback it left parked, so nothing stays reachable", () => {
  const { frames, sleep, loop, state } = setup(1);
  loop.start();
  frames.flush();
  assert.equal(sleep.asleep(), true);
  loop.stop();
  const drawn = state.drawn;
  sleep.wake("change");
  assert.equal(frames.pending.size, 0);
  assert.equal(sleep.asleep(), false);
  assert.equal(state.drawn, drawn);
});

test("stopping the loop cancels its pending frame and watchdog", () => {
  const { frames, timers, loop } = setup();
  loop.start();
  loop.stop();
  assert.equal(frames.pending.size, 0);
  assert.equal(timers.pending.size, 0);
});

test("a hidden tab parks the loop without drawing and showing it again resumes", () => {
  const { frames, tasks, visibility, sleep, loop, state } = setup(100);
  state.settled = true;
  loop.start();
  frames.flush();
  const drawn = state.drawn;
  visibility.set(true);
  assert.equal(frames.pending.size, 0);
  assert.equal(tasks.pending.size, 0);
  assert.equal(sleep.asleep(), false);
  visibility.set(false);
  assert.equal(frames.pending.size, 1);
  frames.flush();
  assert.equal(state.drawn, drawn + 1);
});

test("in a hidden tab a wake draws one frame as a task and the loop parks again", () => {
  const { frames, tasks, visibility, sleep, loop, state } = setup(100);
  state.settled = false;
  loop.start();
  frames.flush();
  visibility.set(true);
  const drawn = state.drawn;
  assert.equal(frames.pending.size, 0);
  assert.equal(tasks.pending.size, 1);
  tasks.flush();
  assert.equal(state.drawn, drawn + 1);
  assert.equal(tasks.pending.size, 0);
  sleep.wake("read");
  assert.equal(frames.pending.size, 0);
  assert.equal(tasks.pending.size, 1);
  tasks.flush();
  assert.equal(state.drawn, drawn + 2);
  assert.equal(tasks.pending.size, 0);
  assert.equal(frames.pending.size, 0);
});

test("a hidden tab with a settled view does not draw on hiding", () => {
  const { frames, tasks, visibility, loop, state } = setup(100);
  state.settled = true;
  loop.start();
  frames.flush();
  const drawn = state.drawn;
  visibility.set(true);
  assert.equal(tasks.pending.size, 0);
  assert.equal(state.drawn, drawn);
});

test("a frame lost in a suspended tab is replaced when the tab returns", () => {
  const { frames, visibility, loop, state } = setup(100);
  state.settled = false;
  loop.start();
  frames.pending.clear();
  visibility.setQuietly(false);
  visibility.set(false);
  assert.equal(frames.pending.size, 1);
  frames.flush();
  assert.equal(state.drawn, 1);
});

test("destroying the sleep stops listening and ignores later wakes", () => {
  const { frames, visibility, sleep, loop, state } = setup(1);
  loop.start();
  frames.flush();
  sleep.destroy();
  assert.equal(visibility.listeners.size, 0);
  sleep.wake("change");
  assert.equal(frames.pending.size, 0);
  assert.equal(state.drawn, 1);
});
