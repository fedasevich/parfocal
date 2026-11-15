export interface HeapPoint {
  readonly visit: number;
  readonly heapBytes: number;
}

export interface HeapTrend {
  readonly samples: number;
  readonly warmUpVisits: number;
  readonly baselineBytes: number;
  readonly lastBytes: number;
  readonly peakBytes: number;
  readonly growth: number;
  readonly growthFromFirst: number;
  readonly slopeBytesPerVisit: number;
}

export interface HeapBudget {
  readonly maxGrowth: number | null;
  readonly maxSlopeBytesPerVisit: number | null;
}

export interface HeapCheck {
  readonly pass: boolean;
  readonly reportOnly: boolean;
  readonly failures: readonly string[];
}

export interface TrendReport {
  readonly name: string;
  readonly trend: HeapTrend;
  readonly budget: HeapBudget;
  readonly check: HeapCheck;
}

export function leastSquaresSlope(points: readonly { x: number; y: number }[]): number {
  if (points.length < 2) return 0;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    covariance += (point.x - meanX) * (point.y - meanY);
    variance += (point.x - meanX) ** 2;
  }
  return variance === 0 ? 0 : covariance / variance;
}

export function heapTrend(points: readonly HeapPoint[], warmUpVisits: number): HeapTrend {
  const first = points[0];
  const baseline = points[warmUpVisits];
  const last = points.at(-1);
  if (!first || !baseline || !last) {
    throw new Error(
      `A heap trend needs more than ${warmUpVisits} samples after warm-up, got ${points.length}`,
    );
  }
  const steady = points.slice(warmUpVisits);
  return {
    samples: points.length,
    warmUpVisits,
    baselineBytes: baseline.heapBytes,
    lastBytes: last.heapBytes,
    peakBytes: Math.max(...steady.map((point) => point.heapBytes)),
    growth: last.heapBytes / baseline.heapBytes - 1,
    growthFromFirst: last.heapBytes / first.heapBytes - 1,
    slopeBytesPerVisit: leastSquaresSlope(
      steady.map((point) => ({ x: point.visit, y: point.heapBytes })),
    ),
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const megabytes = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;

export function checkHeapTrend(trend: HeapTrend, budget: HeapBudget): HeapCheck {
  const failures: string[] = [];
  if (budget.maxGrowth !== null && trend.growth > budget.maxGrowth) {
    failures.push(
      `heap grew ${percent(trend.growth)} after warm-up, over the ${percent(budget.maxGrowth)} budget`,
    );
  }
  if (
    budget.maxSlopeBytesPerVisit !== null &&
    trend.slopeBytesPerVisit > budget.maxSlopeBytesPerVisit
  ) {
    failures.push(
      `heap climbs ${kilobytes(trend.slopeBytesPerVisit)} a visit, over the ${kilobytes(budget.maxSlopeBytesPerVisit)} budget`,
    );
  }
  return {
    pass: failures.length === 0,
    reportOnly: budget.maxGrowth === null && budget.maxSlopeBytesPerVisit === null,
    failures,
  };
}

export function trendReport(
  name: string,
  points: readonly HeapPoint[],
  warmUpVisits: number,
  budget: HeapBudget,
): TrendReport {
  const trend = heapTrend(points, warmUpVisits);
  return { name, trend, budget, check: checkHeapTrend(trend, budget) };
}

function status(check: HeapCheck): string {
  if (!check.pass) return "fail";
  return check.reportOnly ? "report only" : "pass";
}

export function trendMarkdown(reports: readonly TrendReport[]): string {
  const header = [
    "| Run | Samples | Baseline | Last | Peak | Growth | Budget | Slope a visit | Status |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  const rows = reports.map(({ name, trend, budget, check }) =>
    [
      name,
      String(trend.samples),
      megabytes(trend.baselineBytes),
      megabytes(trend.lastBytes),
      megabytes(trend.peakBytes),
      percent(trend.growth),
      budget.maxGrowth === null ? "TODO" : percent(budget.maxGrowth),
      kilobytes(trend.slopeBytesPerVisit),
      status(check),
    ].join(" | "),
  );
  const failures = reports.flatMap((report) =>
    report.check.failures.map((failure) => `- ${report.name}: ${failure}`),
  );
  return [
    "## Memory and leak suite",
    "",
    ...header,
    ...rows.map((row) => `| ${row} |`),
    ...(failures.length > 0 ? ["", ...failures] : []),
    "",
  ].join("\n");
}

export function isTrendReport(value: unknown): value is TrendReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Partial<TrendReport>;
  return (
    typeof report.name === "string" &&
    typeof report.trend?.growth === "number" &&
    typeof report.check?.pass === "boolean" &&
    report.budget !== undefined
  );
}
