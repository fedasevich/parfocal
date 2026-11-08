import assert from "node:assert/strict";
import { test } from "node:test";
import { eventProblems, eventSchema, eventSink } from "../src/telemetry/events.ts";
import { allowedFields } from "../src/telemetry/scrubbing.ts";

const valid = {
  case_id: "case-00000001",
  slide_id: "slide-00000001",
  result_id: "result-00000001",
};

test("a well formed event has no problems", () => {
  assert.deepEqual(eventProblems("review_decision_recorded", { ...valid, decision: "unsure" }), []);
});

test("an event with a free text field is rejected", () => {
  assert.notDeepEqual(
    eventProblems("review_decision_recorded", { ...valid, decision: "unsure", note: "looks odd" }),
    [],
  );
  assert.notDeepEqual(
    eventProblems("navigation_case_opened", { case_id: "Jane Doe", slide_id: valid.slide_id }),
    [],
  );
  assert.notDeepEqual(
    eventProblems("review_decision_recorded", { ...valid, decision: "I disagree because" }),
    [],
  );
  assert.notDeepEqual(
    eventProblems("tool_used", { tool: "brush", slide_id: valid.slide_id, count: "3" }),
    [],
  );
});

test("unknown events and missing fields are rejected", () => {
  assert.notDeepEqual(eventProblems("made_up", {}), []);
  assert.notDeepEqual(eventProblems("task_started", { task_kind: "review" }), []);
  assert.notDeepEqual(eventProblems("toString", {}), []);
});

test("no schema field accepts free text", () => {
  for (const fields of Object.values(eventSchema)) {
    for (const field of Object.values(fields)) {
      assert.ok(["id", "choice", "count"].includes(field.kind));
    }
  }
});

test("every field is on the scrubbing allow-list", () => {
  for (const fields of Object.values(eventSchema)) {
    for (const key of Object.keys(fields)) assert.ok(allowedFields.has(key), key);
  }
});

test("the sink drops invalid events and passes valid ones", () => {
  const seen: string[] = [];
  const sink = eventSink({ capture: (event) => void seen.push(event) });
  sink.track("task_started", { task_kind: "review", case_id: valid.case_id });
  sink.track("task_started", { task_kind: "gossip", case_id: valid.case_id });
  assert.deepEqual(seen, ["task_started"]);
});
