import assert from "node:assert/strict";
import { test } from "node:test";
import { eventSink } from "../src/telemetry/events.ts";
import { seqPoints, susItemCount, susScoreTenths } from "../src/telemetry/survey-items.ts";
import { susItems } from "../src/telemetry/survey-text.ts";
import {
  createSurveyPrompter,
  isPausePath,
  readSurveyState,
  surveyRules,
  surveysEnabled,
} from "../src/telemetry/surveys.ts";

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

function setup(
  options: { held?: boolean; optedOut?: boolean; enabled?: boolean; atPause?: boolean } = {},
) {
  const storage = memoryStorage();
  const events: { name: string; properties: Record<string, unknown> }[] = [];
  let clock = 1_000_000_000;
  let held = options.held ?? false;
  let atPause = options.atPause ?? true;
  const prompter = createSurveyPrompter({
    sink: eventSink(
      { capture: (name, properties) => void events.push({ name, properties }) },
      () => false,
    ),
    now: () => clock,
    held: () => held,
    optedOut: () => options.optedOut ?? false,
    enabled: () => options.enabled ?? true,
    atPause: () => atPause,
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
    pauseAt: (value: boolean) => {
      atPause = value;
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

function sessions(prompter: { sessionStarted(): void }, count: number) {
  for (let session = 0; session < count; session += 1) prompter.sessionStarted();
}

test("the SUS never appears in the first sessions or without a pause", () => {
  const { prompter } = setup();
  sessions(prompter, surveyRules.sessionsBeforeSus - 1);
  prompter.taskFinished("review", caseId);
  prompter.answerSeq(5);
  assert.equal(prompter.current(), null);
  prompter.sessionStarted();
  assert.equal(prompter.current(), null);
});

test("the SUS comes after a finished task once enough sessions passed, and answers once", () => {
  const { prompter, events, advance, storage } = setup();
  sessions(prompter, surveyRules.sessionsBeforeSus);
  assert.equal(prompter.current(), null);
  prompter.taskFinished("review", caseId);
  prompter.answerSeq(4);
  assert.equal(prompter.current()?.survey, "sus");
  assert.equal(prompter.answerSus([3, 3, 3]), false);
  assert.equal(prompter.answerSus([5, 1, 5, 1, 5, 1, 5, 1, 5, 2]), true);
  const answered = events.find((event) => event.name === "sus_answered");
  assert.equal(answered?.properties.sus_score_tenths, 975);
  assert.equal(answered?.properties.item_ten, 2);
  assert.equal(prompter.current(), null);
  sessions(prompter, 20);
  advance(surveyRules.seqGapMs + 1);
  prompter.taskFinished("annotate", caseId);
  prompter.answerSeq(4);
  assert.equal(prompter.current(), null);
  advance(surveyRules.susRepeatMs + 1);
  prompter.taskFinished("upload", caseId);
  prompter.answerSeq(4);
  assert.equal(prompter.current()?.survey, "sus");
  assert.equal(readSurveyState(storage).susNotBefore > 0, true);
});

test("a dismissed SUS waits a whole study period", () => {
  const { prompter, advance } = setup();
  sessions(prompter, surveyRules.sessionsBeforeSus);
  prompter.taskFinished("review", caseId);
  prompter.dismiss();
  assert.equal(prompter.current()?.survey, "sus");
  prompter.dismiss();
  assert.equal(prompter.current(), null);
  advance(surveyRules.seqGapMs + surveyRules.seqDismissedMs + 1);
  sessions(prompter, 10);
  prompter.taskFinished("report", caseId);
  prompter.dismiss();
  assert.equal(prompter.current(), null);
  advance(surveyRules.susRepeatMs);
  prompter.taskFinished("report", caseId);
  prompter.dismiss();
  assert.equal(prompter.current()?.survey, "sus");
});

test("the SUS is not shown on a list or the viewer and returns at a pause", () => {
  const { prompter, pauseAt } = setup({ atPause: false });
  sessions(prompter, surveyRules.sessionsBeforeSus);
  prompter.taskFinished("review", caseId);
  prompter.answerSeq(4);
  assert.equal(prompter.current(), null);
  pauseAt(true);
  assert.equal(prompter.current()?.survey, "sus");
});

test("a SUS armed by a finished task is dropped when it goes stale", () => {
  const { prompter, advance } = setup();
  sessions(prompter, surveyRules.sessionsBeforeSus);
  prompter.taskFinished("review", caseId);
  prompter.answerSeq(4);
  advance(surveyRules.susArmLifeMs + 1);
  assert.equal(prompter.current(), null);
});

test("nothing is offered while the viewer holds the person", () => {
  const { prompter, hold } = setup();
  sessions(prompter, surveyRules.sessionsBeforeSus);
  prompter.taskFinished("review", caseId);
  prompter.answerSeq(4);
  hold(true);
  assert.equal(prompter.current(), null);
  hold(false);
  assert.equal(prompter.current()?.survey, "sus");
});

test("nothing is offered unless the workspace or a study turned surveys on", () => {
  const { prompter, events } = setup({ enabled: false });
  sessions(prompter, 10);
  prompter.taskFinished("review", caseId);
  assert.equal(prompter.current(), null);
  assert.equal(prompter.answerSeq(5), false);
  assert.deepEqual(events, []);
});

test("surveys are off on a fresh device and on only when the setting says so", () => {
  const storage = memoryStorage();
  assert.equal(surveysEnabled(storage), false);
  storage.setItem("parfocal.device-settings", JSON.stringify({ surveys_on: true }));
  assert.equal(surveysEnabled(storage), true);
});

test("only the submitted page counts as a pause", () => {
  assert.equal(isPausePath("/tasks/abc/submitted"), true);
  assert.equal(isPausePath("/projects/abc"), false);
  assert.equal(isPausePath("/projects/abc/slides/s1"), false);
  assert.equal(isPausePath("/tasks/abc/guided"), false);
});

test("the SEQ is offered before the SUS", () => {
  const { prompter } = setup();
  sessions(prompter, surveyRules.sessionsBeforeSus);
  prompter.taskFinished("report", caseId);
  assert.equal(prompter.current()?.survey, "seq");
  prompter.answerSeq(7);
  assert.equal(prompter.current()?.survey, "sus");
});
