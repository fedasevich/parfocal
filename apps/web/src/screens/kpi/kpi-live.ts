import type { TimingEvent } from "@parfocal/api-client";
import type { KpiEvent } from "./kpi-model.ts";

const whole = (value: number | null | undefined) => value ?? 0;

function kpiEventOf(event: TimingEvent): KpiEvent {
  switch (event.name) {
    case "task_finished":
      return {
        name: "task_finished",
        task_kind: event.task_kind ?? "",
        duration_ms: whole(event.duration_ms),
      };
    case "area_time_recorded":
      return {
        name: "area_time_recorded",
        area: event.area ?? "",
        duration_ms: whole(event.duration_ms),
      };
    case "cell_review_timed":
      return { name: "cell_review_timed", duration_ms: whole(event.duration_ms) };
    case "chrome_coverage_measured":
      return {
        name: "chrome_coverage_measured",
        area: event.area ?? "",
        coverage_permille: whole(event.coverage_permille),
      };
    case "reading_time_compared":
      return {
        name: "reading_time_compared",
        task_kind: event.task_kind ?? "",
        estimated_ms: whole(event.estimated_ms),
        duration_ms: whole(event.duration_ms),
      };
  }
}

export function kpiEventsOf(recorded: readonly TimingEvent[]): KpiEvent[] {
  return recorded.map(kpiEventOf);
}
