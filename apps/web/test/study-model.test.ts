import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentRound,
  defaultTasks,
  editTasks,
  initialState,
  isFrozen,
  nextTask,
  parseState,
  recordResult,
  startNextRound,
  startSession,
  summariseRound,
} from "../src/study/study-model.ts";

const oneTask = JSON.stringify([{ id: "a", title: "A", instruction: "Do A" }]);

test("the default round has ten tasks", () => {
  assert.equal(defaultTasks.length, 10);
  assert.equal(currentRound(initialState()).tasks.length, 10);
});

test("an empty round can be edited from JSON", () => {
  const result = editTasks(initialState(), 1, oneTask);
  assert.ok(result.ok);
  assert.equal(currentRound(result.state).tasks.length, 1);
});

test("bad or duplicate task sets are refused", () => {
  assert.equal(editTasks(initialState(), 1, "nope").ok, false);
  const dupes = JSON.stringify([
    { id: "a", title: "A", instruction: "x" },
    { id: "a", title: "B", instruction: "y" },
  ]);
  assert.equal(editTasks(initialState(), 1, dupes).ok, false);
});

test("a round with a session is frozen until the next round starts", () => {
  const running = startSession(initialState(), "P1", "s1", 0);
  assert.ok(isFrozen(running, 1));
  assert.equal(editTasks(running, 1, oneTask).ok, false);
  const next = startNextRound(running);
  assert.equal(currentRound(next).number, 2);
  assert.equal(isFrozen(next, 2), false);
  const edited = editTasks(next, 2, oneTask);
  assert.ok(edited.ok);
  assert.equal(edited.state.rounds[0]?.tasks.length, 10);
});

test("results advance the session and the summary reports medians", () => {
  let state = startSession(initialState(), "P1", "s1", 0);
  state = startSession(state, "P2", "s2", 0);
  state = recordResult(state, "s1", {
    taskId: "t1",
    startedAt: 0,
    endedAt: 10_000,
    outcome: "done",
  });
  state = recordResult(state, "s2", {
    taskId: "t1",
    startedAt: 0,
    endedAt: 20_000,
    outcome: "done",
  });
  state = recordResult(state, "s2", {
    taskId: "t2",
    startedAt: 0,
    endedAt: 5_000,
    outcome: "gave-up",
  });
  const session = state.sessions[0];
  assert.ok(session);
  assert.equal(nextTask(currentRound(state), session)?.id, "t2");
  const summary = summariseRound(state, 1);
  assert.equal(summary[0]?.medianSeconds, 15);
  assert.equal(summary[1]?.completed, 0);
  assert.equal(summary[1]?.sessions, 1);
});

test("a task already answered is not recorded twice", () => {
  let state = startSession(initialState(), "P1", "s1", 0);
  const result = { taskId: "t1", startedAt: 0, endedAt: 1000, outcome: "done" as const };
  state = recordResult(state, "s1", result);
  state = recordResult(state, "s1", result);
  assert.equal(state.sessions[0]?.results.length, 1);
});

test("broken stored state falls back to the default", () => {
  assert.equal(parseState("{").rounds.length, 1);
  assert.equal(parseState(null).sessions.length, 0);
});
