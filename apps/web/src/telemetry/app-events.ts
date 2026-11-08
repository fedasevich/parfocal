import type { Analytics } from "../clients.ts";
import { defaultIdleLockMinutes } from "../session/lock-rules.ts";
import { readingHold } from "../shell/reading-hold.ts";
import { loggingAnalytics } from "./event-log.ts";
import { type EventProperties, type EventSink, eventSink } from "./events.ts";
import { createSurveyPrompter } from "./surveys.ts";
import { createTaskTimer, type TaskTimer } from "./task-timer.ts";

let delegate: Analytics = { capture() {} };

const sink: EventSink = eventSink(
  loggingAnalytics({ capture: (event, properties) => delegate.capture(event, properties) }),
);

export const surveyPrompter = createSurveyPrompter({
  sink,
  now: () => Date.now(),
  held: () => readingHold.isHeld(Date.now(), defaultIdleLockMinutes),
});

const timingSink: EventSink = {
  track(name, properties) {
    sink.track(name, properties);
    if (name === "task_finished") {
      const finished = properties as EventProperties<"task_finished">;
      surveyPrompter.taskFinished(finished.task_kind, finished.case_id);
    }
  },
};

export const taskTimer: TaskTimer = createTaskTimer(timingSink, () => performance.now());

export function connectAppAnalytics(analytics: Analytics): void {
  delegate = analytics;
}
