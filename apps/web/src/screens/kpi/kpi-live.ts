import type { LoggedEvent } from "../../telemetry/event-log.ts";
import type { KpiEvent } from "./kpi-model.ts";

const text = (value: string | number | undefined) => (typeof value === "string" ? value : "");
const number = (value: string | number | undefined) => (typeof value === "number" ? value : 0);

export function liveKpiEvents(log: readonly LoggedEvent[]): KpiEvent[] {
  return log.flatMap((entry): KpiEvent[] => {
    const p = entry.properties;
    switch (entry.name) {
      case "task_finished":
        return [
          {
            name: "task_finished",
            task_kind: text(p["task_kind"]),
            duration_ms: number(p["duration_ms"]),
          },
        ];
      case "area_time_recorded":
        return [
          {
            name: "area_time_recorded",
            area: text(p["area"]),
            duration_ms: number(p["duration_ms"]),
          },
        ];
      case "cell_review_timed":
        return [{ name: "cell_review_timed", duration_ms: number(p["duration_ms"]) }];
      case "chrome_coverage_measured":
        return [
          {
            name: "chrome_coverage_measured",
            area: text(p["area"]),
            coverage_permille: number(p["coverage_permille"]),
          },
        ];
      case "reading_time_compared":
        return [
          {
            name: "reading_time_compared",
            task_kind: text(p["task_kind"]),
            estimated_ms: number(p["estimated_ms"]),
            duration_ms: number(p["duration_ms"]),
          },
        ];
      default:
        return [];
    }
  });
}
