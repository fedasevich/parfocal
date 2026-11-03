import type { DebugCamera, DebugHandleHost, ParfocalHandle } from "../debug-handle.ts";

export const sweepSteps = 180;
export const settleMs = 600;
export const sweepRadius = { x: 480, y: 270 };

export const benchmarkColumns = [
  "renderer",
  "nuclei",
  "zoom",
  "cullMode",
  "frameP50",
  "frameP95",
  "renderMs",
  "fps",
  "drawn",
  "cullMs",
  "cullGpuMs",
  "indexBuildMs",
  "tilesResident",
  "gpuBytes",
  "networkMs",
  "decodeMs",
] as const;

export type BenchmarkColumn = (typeof benchmarkColumns)[number];
export type BenchmarkValue = string | number | null;
export type BenchmarkRow = Record<BenchmarkColumn, BenchmarkValue>;

export type SweepClock = {
  frame: () => Promise<number>;
  wait: (ms: number) => Promise<void>;
};

export class NoSlideOpen extends Error {
  constructor() {
    super("Open a slide in the viewer to run the pan sweep");
  }
}

export function sweepPath(center: DebugCamera, zoom: number, steps = sweepSteps): DebugCamera[] {
  const rx = sweepRadius.x / zoom;
  const ry = sweepRadius.y / zoom;
  return Array.from({ length: steps }, (_, step) => {
    const angle = (2 * Math.PI * (step + 1)) / steps;
    return {
      x: center.x + rx * (Math.cos(angle) - 1),
      y: center.y + ry * Math.sin(angle),
      scale: zoom,
    };
  });
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

function tenth(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;
}

function statsOf(stats: unknown): Partial<BenchmarkRow> {
  if (typeof stats !== "object" || stats === null) return {};
  const picked: Partial<BenchmarkRow> = {};
  for (const column of benchmarkColumns) {
    const value = (stats as Record<string, unknown>)[column];
    if (typeof value === "number" && Number.isFinite(value)) picked[column] = value;
    else if (typeof value === "string") picked[column] = value;
  }
  return picked;
}

export async function runPanSweep(
  handle: ParfocalHandle | undefined,
  zoom: number,
  clock: SweepClock,
): Promise<BenchmarkRow> {
  const start = handle?.getCamera?.() ?? null;
  const setCamera = handle?.setCamera;
  if (start === null || setCamera === undefined || !(zoom > 0)) throw new NoSlideOpen();
  const frames: number[] = [];
  let last = await clock.frame();
  try {
    for (const camera of sweepPath(start, zoom)) {
      setCamera(camera);
      const now = await clock.frame();
      frames.push(now - last);
      last = now;
    }
    await clock.wait(settleMs);
  } finally {
    setCamera(start);
  }
  const stats = statsOf(handle?.getStats?.());
  const mean = frames.reduce((sum, frame) => sum + frame, 0) / frames.length;
  const row = Object.fromEntries(
    benchmarkColumns.map((column) => [column, stats[column] ?? null]),
  ) as BenchmarkRow;
  return {
    ...row,
    renderer: handle?.getRoute?.() ?? row.renderer,
    zoom,
    frameP50: tenth(percentile(frames, 50)),
    frameP95: tenth(percentile(frames, 95)),
    fps: tenth(mean > 0 ? 1000 / mean : null),
  };
}

function csvCell(value: BenchmarkValue): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function benchmarkCsv(rows: readonly BenchmarkRow[]): string {
  const lines = [benchmarkColumns.join(",")];
  for (const row of rows)
    lines.push(benchmarkColumns.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

export function benchmarkFileName(date: Date): string {
  return `parfocal-pan-sweep-${date.toISOString().slice(0, 10)}.csv`;
}

type Listener = () => void;

export function createBenchmarkLog() {
  const rows: BenchmarkRow[] = [];
  const listeners = new Set<Listener>();
  return {
    rows: (): readonly BenchmarkRow[] => rows,
    add: (row: BenchmarkRow) => {
      rows.push(row);
      for (const listener of listeners) listener();
    },
    count: () => rows.length,
    csv: () => benchmarkCsv(rows),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type BenchmarkLog = ReturnType<typeof createBenchmarkLog>;

export const benchmarkLog = createBenchmarkLog();

export const browserClock: SweepClock = {
  frame: () => new Promise((resolve) => requestAnimationFrame(resolve)),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export async function sweepAndLog(
  host: DebugHandleHost,
  zoom: number,
  log: BenchmarkLog = benchmarkLog,
  clock: SweepClock = browserClock,
): Promise<BenchmarkRow> {
  const row = await runPanSweep(host.__parfocal, zoom, clock);
  log.add(row);
  return row;
}

export function benchmarkDebug(
  host: DebugHandleHost,
  log: BenchmarkLog = benchmarkLog,
  clock: SweepClock = browserClock,
): ParfocalHandle {
  return {
    runBenchmark: (zoom) => sweepAndLog(host, zoom, log, clock),
    getSampleCount: () => log.count(),
    csv: () => log.csv(),
  };
}

export function downloadCsv(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
