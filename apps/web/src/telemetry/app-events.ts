import type { Analytics } from "../clients.ts";
import { loggingAnalytics } from "./event-log.ts";
import { type EventSink, eventSink } from "./events.ts";
import { createTaskTimer, type TaskTimer } from "./task-timer.ts";

let delegate: Analytics = { capture() {} };

const sink: EventSink = eventSink(
  loggingAnalytics({ capture: (event, properties) => delegate.capture(event, properties) }),
);

export const taskTimer: TaskTimer = createTaskTimer(sink, () => performance.now());

export function connectAppAnalytics(analytics: Analytics): void {
  delegate = analytics;
}
