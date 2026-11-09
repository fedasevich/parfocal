import type { Analytics } from "../clients.ts";
import { defaultIdleLockMinutes } from "../session/lock-rules.ts";
import { readingHold } from "../shell/reading-hold.ts";
import { loggingAnalytics } from "./event-log.ts";
import { type EventProperties, type EventSink, eventSink } from "./events.ts";
import type { SurveyPrompter } from "./surveys.ts";
import { createTaskTimer, type TaskTimer } from "./task-timer.ts";

let delegate: Analytics = { capture() {} };

const sink: EventSink = eventSink(
  loggingAnalytics({ capture: (event, properties) => delegate.capture(event, properties) }),
);

let surveyPrompter: Promise<SurveyPrompter> | undefined;

export function loadSurveyPrompter(): Promise<SurveyPrompter> {
  surveyPrompter ??= import("./surveys.ts").then(({ createSurveyPrompter }) =>
    createSurveyPrompter({
      sink,
      now: () => Date.now(),
      held: () => readingHold.isHeld(Date.now(), defaultIdleLockMinutes),
    }),
  );
  return surveyPrompter;
}

const timingSink: EventSink = {
  track(name, properties) {
    sink.track(name, properties);
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
