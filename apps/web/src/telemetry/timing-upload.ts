import type { TimedArea, TimedTaskKind, TimingEvent } from "@parfocal/api-client";
import { analyticsOptedOut } from "./consent.ts";
import { type EventName, type EventProperties, type EventSink, eventProblems } from "./events.ts";

type Properties = Record<string, string | number>;

const text = (properties: Properties, key: string) => String(properties[key]);
const number = (properties: Properties, key: string) => Number(properties[key]);

const timingOf: Partial<Record<EventName, (properties: Properties) => TimingEvent>> = {
  task_finished: (p) => ({
    name: "task_finished",
    task_kind: text(p, "task_kind") as TimedTaskKind,
    duration_ms: number(p, "duration_ms"),
  }),
  area_time_recorded: (p) => ({
    name: "area_time_recorded",
    area: text(p, "area") as TimedArea,
    duration_ms: number(p, "duration_ms"),
  }),
  cell_review_timed: (p) => ({ name: "cell_review_timed", duration_ms: number(p, "duration_ms") }),
  chrome_coverage_measured: (p) => ({
    name: "chrome_coverage_measured",
    area: text(p, "area") as TimedArea,
    coverage_permille: number(p, "coverage_permille"),
  }),
  reading_time_compared: (p) => ({
    name: "reading_time_compared",
    task_kind: text(p, "task_kind") as TimedTaskKind,
    estimated_ms: number(p, "estimated_ms"),
    duration_ms: number(p, "duration_ms"),
  }),
};

export function timingEventOf<Name extends EventName>(
  name: Name,
  properties: EventProperties<Name>,
): TimingEvent | undefined {
  const toTiming = timingOf[name];
  if (toTiming === undefined || eventProblems(name, properties).length > 0) return undefined;
  return toTiming(properties);
}

export function timingUploadSink(
  inner: EventSink,
  send: (event: TimingEvent) => Promise<unknown>,
  optedOut: () => boolean = analyticsOptedOut,
): EventSink {
  return {
    track(name, properties) {
      inner.track(name, properties);
      if (optedOut()) return;
      const event = timingEventOf(name, properties);
      if (event !== undefined) void send(event).catch(() => undefined);
    },
  };
}
