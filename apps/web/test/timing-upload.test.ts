import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimingEvent } from "@parfocal/api-client";
import type { EventSink } from "../src/telemetry/events.ts";
import { createTaskTimer } from "../src/telemetry/task-timer.ts";
import { timingUploadSink } from "../src/telemetry/timing-upload.ts";

const caseId = "case-00000001";

function uploader(optedOut = false) {
  const sent: TimingEvent[] = [];
  const tracked: string[] = [];
  const inner: EventSink = { track: (name) => void tracked.push(name) };
  const sink = timingUploadSink(
    inner,
    (event) => {
      sent.push(event);
      return Promise.resolve();
    },
    () => optedOut,
  );
  const clock = { at: 0 };
  const timer = createTaskTimer(sink, () => clock.at);
  return { sent, tracked, timer, clock };
}

test("timing events go to the API without case or slide ids", () => {
  const { sent, tracked, timer, clock } = uploader();
  timer.start("review", caseId);
  clock.at = 600_000;
  timer.finish("review", caseId, 500_000);
  timer.cellShown();
  clock.at = 604_000;
  timer.cellDecided("slide-00000001");
  timer.areaEntered();
  timer.areaLeft("viewer");
  timer.chromeMeasured("viewer", 0.25);
  assert.deepEqual(sent, [
    { name: "task_finished", task_kind: "review", duration_ms: 600_000 },
    {
      name: "reading_time_compared",
      task_kind: "review",
      estimated_ms: 500_000,
      duration_ms: 600_000,
    },
    { name: "cell_review_timed", duration_ms: 4_000 },
    { name: "area_time_recorded", area: "viewer", duration_ms: 0 },
    { name: "chrome_coverage_measured", area: "viewer", coverage_permille: 250 },
  ]);
  assert.equal(tracked[0], "task_started");
  assert.equal(JSON.stringify(sent).includes("0000000"), false);
});

test("nothing goes to the API after the analytics opt-out", () => {
  const { sent, timer, clock } = uploader(true);
  timer.start("review", caseId);
  clock.at = 1_000;
  timer.finish("review", caseId);
  assert.deepEqual(sent, []);
});

test("a failed upload is swallowed", async () => {
  const sink = timingUploadSink(
    { track() {} },
    () => Promise.reject(new Error("offline")),
    () => false,
  );
  sink.track("cell_review_timed", { slide_id: "slide-00000001", duration_ms: 10 });
  await new Promise((resolve) => setTimeout(resolve, 0));
});
