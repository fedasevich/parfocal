import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkMet,
  currentRound,
  defaultTasks,
  editTasks,
  initialState,
  isFrozen,
  nextTask,
  type PageProbe,
  parseState,
  recordResult,
  resolveStartPath,
  type StudyContext,
  type StudyTask,
  startNextRound,
  startSession,
  studySlide,
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

const context: StudyContext = {
  slides: [{ id: "s-44", label: "tumor_044", project: { id: "p-7" } }],
  resume: { projectId: "p-7", slideId: "s-a1", taskId: "rt-14" },
};

const page = (url: string, counts: Record<string, number> = {}, text = ""): PageProbe => ({
  url,
  count: (selector) => counts[selector] ?? 0,
  text: () => text,
});

test("every default task opens a start screen and slide tasks open the CAMELYON16 slide", () => {
  for (const task of defaultTasks) {
    const path = resolveStartPath(task, context);
    assert.ok(path?.startsWith("/projects/p-7"), task.id);
    if (task.slide !== undefined) assert.equal(task.slide, studySlide);
  }
  const live = defaultTasks.find((task) => task.id === "t2");
  assert.ok(live);
  assert.equal(resolveStartPath(live, context), "/projects/p-7/slides/s-44/live?task=rt-14&as=DH");
});

test("a start screen whose slide is not listed is not offered", () => {
  const task: StudyTask = {
    id: "x",
    title: "X",
    instruction: "X",
    slide: "tumor_999",
    startPath: "/projects/{project}",
  };
  assert.equal(resolveStartPath(task, context), undefined);
});

test("a check needs its path, selector count and text all at once", () => {
  const task: StudyTask = {
    id: "x",
    title: "X",
    instruction: "X",
    slide: "tumor_044",
    check: { path: "/slides/{slide}/live", selector: ".ready", text: "agree", minCount: 2 },
  };
  const live = "/projects/p-7/slides/s-44/live?task=rt-14";
  assert.equal(checkMet(task, context, page(live, { ".ready": 2 }, "agree, agree")), true);
  assert.equal(checkMet(task, context, page(live, { ".ready": 1 }, "agree, agree")), false);
  assert.equal(checkMet(task, context, page(live, { ".ready": 2 }, "agree")), false);
  assert.equal(checkMet(task, context, page("/", { ".ready": 2 }, "agree, agree")), false);
  assert.equal(checkMet({ ...task, check: undefined }, context, page(live)), false);
});

test("a selector the page cannot parse fails the check instead of throwing", () => {
  const task: StudyTask = { id: "x", title: "X", instruction: "X", check: { selector: "[" } };
  const broken: PageProbe = {
    url: "/",
    count: () => {
      throw new SyntaxError("bad selector");
    },
    text: () => "",
  };
  assert.equal(checkMet(task, context, broken), false);
});

test("task sets with an empty or broken check are refused", () => {
  const empty = JSON.stringify([{ id: "a", title: "A", instruction: "x", check: {} }]);
  const broken = JSON.stringify([{ id: "a", title: "A", instruction: "x", check: { text: "(" } }]);
  assert.equal(editTasks(initialState(), 1, empty).ok, false);
  assert.equal(editTasks(initialState(), 1, broken).ok, false);
});

test("a state saved before checks existed still loads with its sessions", () => {
  const old = JSON.stringify({
    rounds: [
      { number: 1, tasks: [{ id: "t1", title: "Open", instruction: "Open it", startPath: "/" }] },
    ],
    sessions: [
      {
        id: "s1",
        round: 1,
        participant: "P1",
        startedAt: 0,
        results: [{ taskId: "t1", startedAt: 0, endedAt: 1000, outcome: "done" }],
      },
    ],
  });
  const state = parseState(old);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.rounds[0]?.tasks[0]?.title, "Open");
});

test("broken stored state falls back to the default", () => {
  assert.equal(parseState("{").rounds.length, 1);
  assert.equal(parseState(null).sessions.length, 0);
});
