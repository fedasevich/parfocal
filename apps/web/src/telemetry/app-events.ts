import { recordTimingEvents } from "@parfocal/api-client";
import type { Analytics } from "../clients.ts";
import { defaultIdleLockMinutes } from "../session/lock-rules.ts";
import { readingHold } from "../shell/reading-hold.ts";
import { loggingAnalytics } from "./event-log.ts";
import { type EventProperties, type EventSink, eventSink } from "./events.ts";
import type { SurveyPrompter } from "./surveys.ts";
import { createTaskTimer, type TaskTimer } from "./task-timer.ts";
import { timingUploadSink } from "./timing-upload.ts";

let delegate: Analytics = { capture() {} };

const sink: EventSink = eventSink(
  loggingAnalytics({ capture: (event, properties) => delegate.capture(event, properties) }),
);

export const appEventSink: EventSink = sink;

let surveyPrompter: Promise<SurveyPrompter> | undefined;

export function loadSurveyPrompter(): Promise<SurveyPrompter> {
  surveyPrompter ??= import("./surveys.ts").then(({ createSurveyPrompter, isPausePath }) =>
    createSurveyPrompter({
      sink,
      now: () => Date.now(),
      atPause: () => isPausePath(window.location.pathname),
      held: () => readingHold.isHeld(Date.now(), defaultIdleLockMinutes),
    }),
  );
  return surveyPrompter;
}

const recordingSink: EventSink = timingUploadSink(sink, (event) =>
  recordTimingEvents({ events: [event] }, { keepalive: true }),
);

const timingSink: EventSink = {
  track(name, properties) {
    recordingSink.track(name, properties);
    if (name === "task_finished") {
      const finished = properties as EventProperties<"task_finished">;
      void loadSurveyPrompter().then((prompter) =>
        prompter.taskFinished(finished.task_kind, finished.case_id),
      );
    }
  },
};

export const taskTimer: TaskTimer = createTaskTimer(timingSink, () => performance.now());

export function connectAppAnalytics(analytics: Analytics): void {
  delegate = analytics;
}
