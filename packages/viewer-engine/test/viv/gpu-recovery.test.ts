import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGpuGuard,
  defaultLossWindowMs,
  defaultMaxLossesInWindow,
  defaultRestoreTimeoutMs,
  type GpuEventSource,
  type GpuUnrecoverableError,
  gpuFailureMessage,
  isGpuUnrecoverableError,
} from "../../src/viv/gpu-recovery.ts";
import { FakeTimers, FakeVisibility } from "../scheduling-fakes.ts";

class FakeCanvas implements GpuEventSource {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  count(): number {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }

  fire(type: "webglcontextlost" | "webglcontextrestored"): { prevented: boolean } {
    const state = { prevented: false };
    const event = {
      preventDefault: () => {
        state.prevented = true;
      },
    } as unknown as Event;
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return state;
  }
}

function harness(overrides: { rebuild?: () => void; maxLossesInWindow?: number } = {}) {
  const canvas = new FakeCanvas();
  const timers = new FakeTimers();
  const visibility = new FakeVisibility();
  const log: string[] = [];
  const failures: GpuUnrecoverableError[] = [];
  let time = 0;
  const guard = createGpuGuard({
    timers,
    visibility,
    now: () => time,
    onLost: () => log.push("lost"),
    rebuild:
      overrides.rebuild ??
      (() => {
        log.push("rebuild");
      }),
    onUnrecoverable: (error) => failures.push(error),
    ...(overrides.maxLossesInWindow === undefined
      ? {}
      : { maxLossesInWindow: overrides.maxLossesInWindow }),
  });
  guard.attach(canvas);
  return {
    canvas,
    timers,
    visibility,
    log,
    failures,
    guard,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("a context loss is cancelled so the browser may restore it, and a restore rebuilds once", () => {
  const { canvas, guard, log, timers } = harness();
  assert.equal(guard.status(), "ready");
  const lost = canvas.fire("webglcontextlost");
  assert.equal(lost.prevented, true);
  assert.equal(guard.status(), "lost");
  assert.deepEqual(log, ["lost"]);
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0]?.ms, defaultRestoreTimeoutMs);
  canvas.fire("webglcontextrestored");
  assert.equal(guard.status(), "ready");
  assert.deepEqual(log, ["lost", "rebuild"]);
  assert.equal(timers.pending.size, 0);
  assert.deepEqual(guard.stats(), { losses: 1, recoveries: 1 });
});

test("a restore that never comes ends in one unrecoverable error with a message for the user", () => {
  const { canvas, guard, failures, timers } = harness();
  canvas.fire("webglcontextlost");
  timers.fire();
  assert.equal(guard.status(), "failed");
  assert.equal(failures.length, 1);
  const [error] = failures;
  assert.ok(isGpuUnrecoverableError(error));
  assert.equal(error?.reason, "restore-timeout");
  assert.equal(error?.userMessage, gpuFailureMessage);
  assert.equal(canvas.count(), 0);
  canvas.fire("webglcontextrestored");
  canvas.fire("webglcontextlost");
  assert.equal(failures.length, 1);
});

test("the restore timeout does not run while the tab is hidden and starts again when it shows", () => {
  const { canvas, guard, failures, timers, visibility } = harness();
  visibility.set(true);
  canvas.fire("webglcontextlost");
  assert.equal(timers.pending.size, 0);
  visibility.set(false);
  assert.equal(timers.pending.size, 1);
  visibility.set(true);
  assert.equal(timers.pending.size, 0);
  assert.equal(guard.status(), "lost");
  assert.equal(failures.length, 0);
  visibility.set(false);
  canvas.fire("webglcontextrestored");
  assert.equal(guard.status(), "ready");
  assert.equal(timers.pending.size, 0);
});

test("losses beyond the window limit are unrecoverable, and old losses age out", () => {
  const first = harness();
  for (let loss = 0; loss < defaultMaxLossesInWindow; loss++) {
    first.canvas.fire("webglcontextlost");
    first.canvas.fire("webglcontextrestored");
    first.advance(1000);
  }
  assert.equal(first.guard.status(), "ready");
  first.canvas.fire("webglcontextlost");
  assert.equal(first.guard.status(), "failed");
  assert.equal(first.failures[0]?.reason, "repeated-loss");

  const aged = harness();
  for (let loss = 0; loss < defaultMaxLossesInWindow * 2; loss++) {
    aged.canvas.fire("webglcontextlost");
    aged.canvas.fire("webglcontextrestored");
    aged.advance(defaultLossWindowMs);
  }
  assert.equal(aged.guard.status(), "ready");
  assert.equal(aged.failures.length, 0);
});

test("a rebuild that throws is unrecoverable and carries its cause", () => {
  const cause = new Error("no context");
  const { canvas, guard, failures } = harness({
    rebuild: () => {
      throw cause;
    },
  });
  canvas.fire("webglcontextlost");
  canvas.fire("webglcontextrestored");
  assert.equal(guard.status(), "failed");
  assert.equal(failures[0]?.reason, "rebuild-failed");
  assert.equal(failures[0]?.cause, cause);
});

test("attaching a new canvas moves the listeners and ignores the old canvas", () => {
  const { canvas, guard, log } = harness();
  const next = new FakeCanvas();
  guard.attach(next);
  assert.equal(canvas.count(), 0);
  assert.equal(next.count(), 2);
  canvas.fire("webglcontextlost");
  assert.deepEqual(log, []);
  next.fire("webglcontextlost");
  assert.deepEqual(log, ["lost"]);
});

test("a restore without a loss does nothing", () => {
  const { canvas, log } = harness();
  canvas.fire("webglcontextrestored");
  assert.deepEqual(log, []);
});

test("destroy removes every listener and timer, and later events do nothing", () => {
  const { canvas, guard, log, timers, visibility } = harness();
  canvas.fire("webglcontextlost");
  guard.destroy();
  assert.equal(canvas.count(), 0);
  assert.equal(timers.pending.size, 0);
  assert.equal(visibility.listeners.size, 0);
  canvas.fire("webglcontextrestored");
  assert.deepEqual(log, ["lost"]);
  guard.destroy();
});

test("the failure error is an Error with a stable reason", () => {
  const { canvas, failures, timers } = harness();
  canvas.fire("webglcontextlost");
  timers.fire();
  assert.ok(failures[0] instanceof Error);
  assert.equal(failures[0]?.name, "GpuUnrecoverableError");
  assert.equal(isGpuUnrecoverableError(new Error("other")), false);
});
