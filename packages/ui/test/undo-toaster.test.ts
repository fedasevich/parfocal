import assert from "node:assert/strict";
import { test } from "node:test";
import { createUndoToaster, undoWindowMs } from "../src/lib/undo-toaster.ts";

function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  return {
    scheduler: {
      setTimeout: (callback: () => void, ms: number) => {
        const handle = nextHandle++;
        pending.set(handle, { at: now + ms, callback });
        return handle;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, entry] of [...pending]) {
        if (entry.at <= now) {
          pending.delete(handle);
          entry.callback();
        }
      }
    },
  };
}

function setup() {
  const clock = fakeClock();
  const toaster = createUndoToaster({ scheduler: clock.scheduler });
  const state = { decision: "pending" as string };
  return { clock, toaster, state };
}

test("the window is 4 seconds", () => {
  assert.equal(undoWindowMs, 4000);
});

test("undo inside the window restores the exact state before the action", () => {
  const { clock, toaster, state } = setup();
  const before = state.decision;
  state.decision = "agree";
  const id = toaster.show({
    message: "T1 marked agree",
    undo: () => {
      state.decision = before;
    },
  });
  assert.deepEqual(toaster.current(), { id, message: "T1 marked agree", canUndo: true });
  clock.advance(undoWindowMs - 1);
  assert.equal(toaster.undo(id), true);
  assert.equal(state.decision, "pending");
  assert.equal(toaster.current(), null);
});

test("undo after the window does nothing and the toast is gone", () => {
  const { clock, toaster, state } = setup();
  state.decision = "agree";
  const id = toaster.show({
    message: "T1 marked agree",
    undo: () => {
      state.decision = "pending";
    },
  });
  clock.advance(undoWindowMs);
  assert.equal(toaster.current(), null);
  assert.equal(toaster.undo(id), false);
  assert.equal(state.decision, "agree");
});

test("undo runs once", () => {
  const { toaster } = setup();
  let runs = 0;
  const id = toaster.show({ message: "Run cancelled", undo: () => void runs++ });
  assert.equal(toaster.undo(id), true);
  assert.equal(toaster.undo(id), false);
  assert.equal(runs, 1);
});

test("a newer action replaces the toast and keeps the older action done", () => {
  const { clock, toaster } = setup();
  let firstUndone = false;
  const first = toaster.show({
    message: "T1 marked agree",
    undo: () => {
      firstUndone = true;
    },
  });
  clock.advance(3000);
  const second = toaster.show({ message: "T2 marked disagree", undo: () => {} });
  assert.notEqual(first, second);
  assert.equal(toaster.undo(first), false);
  assert.equal(firstUndone, false);
  clock.advance(3000);
  assert.equal(toaster.current()?.id, second);
  clock.advance(1000);
  assert.equal(toaster.current(), null);
});

test("a toast without undo offers none and still expires", () => {
  const { clock, toaster } = setup();
  const id = toaster.show({ message: "Still offline" });
  assert.equal(toaster.current()?.canUndo, false);
  assert.equal(toaster.undo(id), false);
  assert.equal(toaster.current()?.id, id);
  clock.advance(undoWindowMs);
  assert.equal(toaster.current(), null);
});

test("listeners hear about show, undo and expiry, and stop after unsubscribe", () => {
  const { clock, toaster } = setup();
  let heard = 0;
  const stop = toaster.subscribe(() => void heard++);
  const id = toaster.show({ message: "A", undo: () => {} });
  toaster.undo(id);
  toaster.show({ message: "B" });
  clock.advance(undoWindowMs);
  assert.equal(heard, 4);
  stop();
  toaster.show({ message: "C" });
  assert.equal(heard, 4);
});

test("dismissing an old id does not close a newer toast", () => {
  const { toaster } = setup();
  const first = toaster.show({ message: "A" });
  const second = toaster.show({ message: "B" });
  toaster.dismiss(first);
  assert.equal(toaster.current()?.id, second);
});
