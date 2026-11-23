import assert from "node:assert/strict";
import { test } from "node:test";
import { makeCode } from "../src/study/participant-run.ts";
import {
  answerFinal,
  answerTask,
  finishFinal,
  initialState,
  parseState,
  recordTask,
  resolveStartPath,
  round5Tasks,
  type StudyState,
  startParticipantSession,
  summariseRound,
  susScore,
  type TaskRecord,
} from "../src/study/study-model.ts";

const record = (id: string, success: boolean): TaskRecord => ({
  id,
  idx: 0,
  title: "Open the slide",
  goal: "Open the slide from the list.",
  success,
  durationMs: 4200,
  clicks: 3,
  deadClicks: 1,
  blocked: 0,
  keys: 2,
  wheels: 5,
  seq: null,
  notes: {},
  reason: success ? null : "where-to-look",
  endedAt: 5200,
});

const started = (): StudyState => startParticipantSession(initialState(), "P-AB23", "s1", 1000);

test("SUS scores round 4's way, odd items v-1 and even items 5-v, times 2.5", () => {
  assert.equal(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100);
  assert.equal(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.equal(susScore([5, 4, 4, 4, 4, 4, 4, 4, 4, 4]), 52.5);
  assert.equal(susScore([5, 4, 4, 4, 4, 4, 4, 4, 4, null]), null);
});

test("a participant session keeps consent, round 4 task metrics, SEQ and notes", () => {
  let state = started();
  state = recordTask(state, "s1", record("open-case", true), 1000);
  state = answerTask(state, "s1", "open-case", 6, { like: "clear" });
  state = recordTask(state, "s1", record("patient-details", false), 6000);
  const session = parseState(JSON.stringify(state)).sessions[0];
  assert.equal(session?.consentAt, 1000);
  assert.deepEqual(
    session?.tasks?.map((entry) => [entry.id, entry.seq, entry.notes, entry.reason]),
    [
      ["open-case", 6, { like: "clear" }, null],
      ["patient-details", null, {}, "where-to-look"],
    ],
  );
  assert.deepEqual(
    session?.results.map((result) => result.outcome),
    ["done", "gave-up"],
  );
  assert.equal(summariseRound(state, 1)[0]?.completed, 1);
});

test("final answers log each changed answer, not first answers, and rescore SUS", () => {
  let state = started();
  state = answerFinal(state, "s1", { sus: Array.from({ length: 10 }, () => 4) }, 10);
  state = answerFinal(state, "s1", { open: { like: "the list" } }, 20);
  state = answerFinal(state, "s1", { sus: [5, 4, 4, 4, 4, 4, 4, 4, 4, 4] }, 30);
  state = answerFinal(state, "s1", { open: { like: "the list" } }, 40);
  state = answerFinal(state, "s1", { open: { like: "the slide list" } }, 50);
  state = finishFinal(state, "s1", 60);
  const final = parseState(JSON.stringify(state)).sessions[0]?.final;
  assert.equal(final?.susScore, 52.5);
  assert.equal(final?.finishedAt, 60);
  assert.deepEqual(final?.open, { like: "the slide list" });
  assert.deepEqual(final?.changes, [
    { key: "sus1", from: 4, to: 5, at: 30 },
    { key: "like", from: "the list", to: "the slide list", at: 50 },
  ]);
});

test("round 5 tasks start in the participant's seeded project and keep round 4's goals", () => {
  const bare = { slides: [], resume: null };
  const participant = {
    projectId: "x-studyProject",
    reviewTask: "x-reviewTask",
    reviewSlide: "x-reviewSlide",
    queueTask: "x-queueTask",
    queueSlide: "x-queueSlide",
    annotateTask: "x-annotateTask",
    annotateSlide: "x-annotateSlide",
    cellTask: "x-cellTask",
    cellSlide: "x-cellSlide",
  };
  for (const task of round5Tasks) {
    assert.equal(resolveStartPath(task, bare), undefined, task.id);
    const path = resolveStartPath(task, { ...bare, participant });
    assert.ok(path?.startsWith("/") && !path.includes("{"), task.id);
  }
  const goal = (id: string) => round5Tasks.find((task) => task.id === id)?.instruction;
  assert.equal(
    goal("unsure-place"),
    "The AI is unsure about some cells on this slide. Go to the place where it is the least sure.",
  );
  assert.equal(
    goal("check-cells"),
    "The AI was unsure about some of the cells in this place. Give your answer for at least 4 of them. Any answer is fine.",
  );
  assert.equal(
    goal("whole-slide"),
    "Quickly bring up a view of the entire tissue scan, then get back to the close-up you were looking at.",
  );
  const cells = round5Tasks.find((task) => task.id === "check-cells");
  assert.ok(cells);
  assert.equal(
    resolveStartPath(cells, { ...bare, participant }),
    "/projects/x-studyProject/slides/x-cellSlide?task=x-cellTask",
  );
  const queue = round5Tasks.find((task) => task.id === "queue-decision");
  assert.ok(queue);
  assert.equal(
    resolveStartPath(queue, { ...bare, participant }),
    "/tasks/x-queueTask/disagreements",
  );
});

test("the anonymous code is P- and four letters from nur's alphabet", () => {
  assert.match(makeCode(), /^P-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
  assert.equal(
    makeCode(() => 0),
    "P-AAAA",
  );
});
