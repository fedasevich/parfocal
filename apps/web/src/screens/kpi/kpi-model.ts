export type KpiEvent =
  | { name: "task_finished"; task_kind: string; duration_ms: number }
  | { name: "area_time_recorded"; area: string; duration_ms: number }
  | { name: "cell_review_timed"; duration_ms: number }
  | { name: "chrome_coverage_measured"; area: string; coverage_permille: number }
  | {
      name: "reading_time_compared";
      task_kind: string;
      estimated_ms: number;
      duration_ms: number;
    };

export type KpiKey = "review" | "sign_out" | "area" | "cell" | "chrome" | "estimate";

export type KpiTarget = {
  limit: number;
  source: string;
};

export type Kpi = {
  key: KpiKey;
  label: string;
  unit: "minutes" | "seconds" | "percent";
  samples: number;
  median: number | null;
  slowest: number | null;
  target: KpiTarget | null;
  met: boolean | null;
};

const minute = 60_000;

export const kitTargets: Record<KpiKey, KpiTarget | null> = {
  review: { limit: 15, source: "UX kit brief, under 15 minutes per slide" },
  sign_out: null,
  area: null,
  cell: null,
  chrome: { limit: 35, source: "Chrome budget, at most 35 percent of the viewer" },
  estimate: null,
};

export function percentile(values: readonly number[], share: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
}

const round = (value: number | null, digits: number) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

function summarize(key: KpiKey, label: string, unit: Kpi["unit"], values: readonly number[]): Kpi {
  const median = round(percentile(values, 0.5), 1);
  const target = kitTargets[key];
  return {
    key,
    label,
    unit,
    samples: values.length,
    median,
    slowest: round(percentile(values, 0.9), 1),
    target,
    met: target === null || median === null ? null : median <= target.limit,
  };
}

export function estimateErrors(events: readonly KpiEvent[]): number[] {
  return events.flatMap((event) =>
    event.name === "reading_time_compared" && event.estimated_ms > 0
      ? [(Math.abs(event.duration_ms - event.estimated_ms) / event.estimated_ms) * 100]
      : [],
  );
}

export function computeKpis(events: readonly KpiEvent[]): Kpi[] {
  const finished = (kind: string) =>
    events.flatMap((event) =>
      event.name === "task_finished" && event.task_kind === kind
        ? [event.duration_ms / minute]
        : [],
    );
  const cells = events.flatMap((event) =>
    event.name === "cell_review_timed" ? [event.duration_ms / 1000] : [],
  );
  const areaTimes = events.flatMap((event) =>
    event.name === "area_time_recorded" ? [event.duration_ms / minute] : [],
  );
  const chrome = events.flatMap((event) =>
    event.name === "chrome_coverage_measured" ? [event.coverage_permille / 10] : [],
  );
  return [
    summarize("review", "Time per slide reviewed", "minutes", finished("review")),
    summarize("sign_out", "Time per sign-out", "minutes", finished("report")),
    summarize("area", "Time per area visit", "minutes", areaTimes),
    summarize("cell", "Time per cell reviewed", "seconds", cells),
    summarize("chrome", "Chrome coverage of the viewer", "percent", chrome),
    summarize("estimate", "Reading time estimate error", "percent", estimateErrors(events)),
  ];
}

export function areaMedians(events: readonly KpiEvent[]): { area: string; minutes: number }[] {
  const byArea = new Map<string, number[]>();
  for (const event of events) {
    if (event.name !== "area_time_recorded") continue;
    byArea.set(event.area, [...(byArea.get(event.area) ?? []), event.duration_ms / minute]);
  }
  return [...byArea.entries()]
    .map(([area, values]) => ({ area, minutes: round(percentile(values, 0.5), 1) ?? 0 }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function formatKpiValue(value: number | null, unit: Kpi["unit"]): string {
  if (value === null) return "No data";
  if (unit === "percent") return `${value}%`;
  return `${value} ${unit === "minutes" ? "min" : "s"}`;
}
