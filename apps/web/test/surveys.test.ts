import assert from "node:assert/strict";
import { test } from "node:test";
import { eventSink } from "../src/telemetry/events.ts";
import { seqPoints, susItemCount, susScoreTenths } from "../src/telemetry/survey-items.ts";
import { susItems } from "../src/telemetry/survey-text.ts";
import { createSurveyPrompter, readSurveyState, surveyRules } from "../src/telemetry/surveys.ts";

const caseId = "case-00000001";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    dump: () => [...values.values()].join(" "),
  };
}

function setup(options: { held?: boolean; optedOut?: boolean } = {}) {
  const storage = memoryStorage();
  const events: { name: string; properties: Record<string, unknown> }[] = [];
  let clock = 1_000_000_000;
  let held = options.held ?? false;
  const prompter = createSurveyPrompter({
    sink: eventSink(
      { capture: (name, properties) => void events.push({ name, properties }) },
      () => false,
    ),
    now: () => clock,
    held: () => held,
    optedOut: () => options.optedOut ?? false,
    storage,
  });
  return {
    prompter,
    storage,
    events,
    advance: (ms: number) => {
      clock += ms;
    },
    hold: (value: boolean) => {
      held = value;
    },
  };
}

test("the SUS has the ten standard items and scores a perfect run at 100", () => {
  assert.equal(susItems.length, susItemCount);
  assert.equal(susItems[0], "I think that I would like to use this system frequently.");
  assert.equal(
    susItems[9],
    "I needed to learn a lot of things before I could get going with this system.",
  );
  assert.equal(susScoreTenths([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 1000);
  assert.equal(susScoreTenths([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.equal(susScoreTenths([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 500);
  assert.equal(susScoreTenths([3, 3, 3]), null);
  assert.equal(susScoreTenths([6, 1, 5, 1, 5, 1, 5, 1, 5, 1]), null);
});

test("a finished task offers the SEQ and an answer is stored as ids and numbers only", () => {
  const { prompter, events, storage } = setup();
  prompter.taskFinished("review", caseId);
  assert.equal(prompter.current()?.survey, "seq");
  assert.equal(prompter.answerSeq(seqPoints + 1), false);
  assert.equal(prompter.answerSeq(6), true);
  assert.deepEqual(events, [
    {
      name: "seq_answered",
      properties: { task_kind: "review", case_id: caseId, ease_score: 6 },
    },
  ]);
  assert.equal(prompter.current(), null);
  assert.doesNotMatch(storage.dump(), /case-0000/);
});

test("the SEQ is rate limited by gap and by task kind", () => {
  const { prompter, advance } = setup();
  prompter.taskFinished("review", caseId);
  prompter.answerSeq(5);
  prompter.taskFinished("annotate", caseId);
  assert.equal(prompter.current(), null);
  advance(surveyRules.seqGapMs + 1);
  prompter.taskFinished("review", caseId);
  assert.equal(prompter.current(), null);
  prompter.taskFinished("annotate", caseId);
  assert.equal(prompter.current()?.survey, "seq");
  prompter.dismiss();
  advance(surveyRules.seqGapMs + 1);
  prompter.taskFinished("annotate", caseId);
  assert.equal(prompter.current(), null);
  advance(surveyRules.seqPerKindMs);
  prompter.taskFinished("review", caseId);
  assert.equal(prompter.current()?.survey, "seq");
});

test("dismissing records only which survey was dismissed", () => {
  const { prompter, events } = setup();
  prompter.taskFinished("upload", caseId);
  prompter.dismiss();
  assert.deepEqual(events, [{ name: "survey_dismissed", properties: { survey: "seq" } }]);
  assert.equal(prompter.current(), null);
});

test("nothing is offered while a slide is open and the offer returns afterwards", () => {
  const { prompter, hold } = setup({ held: true });
  prompter.taskFinished("review", caseId);
  assert.equal(prompter.current(), null);
  hold(false);
  assert.equal(prompter.current()?.survey, "seq");
});

test("a stale SEQ offer is dropped", () => {
  const { prompter, advance } = setup();
  prompter.taskFinished("review", caseId);
  advance(surveyRules.seqOfferLifeMs + 1);
  assert.equal(prompter.current(), null);
});

test("opting out of analytics offers and records nothing", () => {
  const { prompter, events } = setup({ optedOut: true });
  for (let session = 0; session < 10; session += 1) prompter.sessionStarted();
  prompter.taskFinished("review", caseId);
  assert.equal(prompter.current(), null);
  assert.equal(prompter.answerSeq(4), false);
  assert.deepEqual(events, []);
});

test("the SUS comes after enough sessions, once, and backs off after a dismissal", () => {
  const { prompter, events, advance, storage } = setup();
  for (let session = 1; session < surveyRules.sessionsBeforeSus; session += 1) {
    prompter.sessionStarted();
    assert.equal(prompter.current(), null);
  }
  prompter.sessionStarted();
  assert.equal(prompter.current()?.survey, "sus");
  assert.equal(prompter.answerSus([3, 3, 3]), false);
  assert.equal(prompter.answerSus([5, 1, 5, 1, 5, 1, 5, 1, 5, 2]), true);
  const answered = events[0];
  assert.equal(answered?.name, "sus_answered");
  assert.equal(answered?.properties.sus_score_tenths, 975);
  assert.equal(answered?.properties.item_ten, 2);
  assert.equal(prompter.current(), null);
  for (let session = 0; session < 20; session += 1) prompter.sessionStarted();
  assert.equal(prompter.current(), null);
  advance(surveyRules.susRepeatMs + 1);
  assert.equal(prompter.current()?.survey, "sus");
  prompter.dismiss();
  assert.equal(prompter.current(), null);
  assert.equal(readSurveyState(storage).susNotBefore > 0, true);
});

test("the SEQ is offered before the SUS", () => {
  const { prompter } = setup();
  for (let session = 0; session < surveyRules.sessionsBeforeSus; session += 1) {
    prompter.sessionStarted();
  }
  prompter.taskFinished("report", caseId);
  assert.equal(prompter.current()?.survey, "seq");
  prompter.answerSeq(7);
  assert.equal(prompter.current()?.survey, "sus");
});
