import type { KpiEvent } from "./kpi-model.ts";

const minute = 60_000;

const reviewMinutes = [9.5, 11, 12, 12.5, 13, 14, 14.5, 16, 17.5, 11.5];
const signOutMinutes = [3.2, 4.1, 4.8, 5.5, 3.9, 6.2];
const cellSeconds = [4, 6, 7, 8, 9, 11, 14, 5, 7, 10];
const chromePercent = [31, 32, 33, 34.5, 29];
const estimates: [number, number][] = [
  [12, 11],
  [12, 14.5],
  [10, 9],
  [15, 13],
  [8, 9.5],
];
const areaVisits: [string, number][] = [
  ["home", 0.4],
  ["cases", 1.5],
  ["viewer", 11],
  ["viewer", 13],
  ["reports", 4.5],
  ["search", 1.2],
  ["cases", 2],
];

export const seededKpiEvents: KpiEvent[] = [
  ...reviewMinutes.map(
    (m): KpiEvent => ({
      name: "task_finished",
      task_kind: "review",
      duration_ms: Math.round(m * minute),
    }),
  ),
  ...signOutMinutes.map(
    (m): KpiEvent => ({
      name: "task_finished",
      task_kind: "report",
      duration_ms: Math.round(m * minute),
    }),
  ),
  ...cellSeconds.map((s): KpiEvent => ({ name: "cell_review_timed", duration_ms: s * 1000 })),
  ...chromePercent.map(
    (p): KpiEvent => ({
      name: "chrome_coverage_measured",
      area: "viewer",
      coverage_permille: Math.round(p * 10),
    }),
  ),
  ...estimates.map(
    ([estimated, actual]): KpiEvent => ({
      name: "reading_time_compared",
      task_kind: "review",
      estimated_ms: estimated * minute,
      duration_ms: Math.round(actual * minute),
    }),
  ),
  ...areaVisits.map(
    ([area, m]): KpiEvent => ({
      name: "area_time_recorded",
      area,
      duration_ms: Math.round(m * minute),
    }),
  ),
];
