import { httpCellSource, PagedCells, type PagedStats } from "../../src/index.ts";

export interface PagingConfig {
  readonly origin: string;
  readonly slideWidth: number;
  readonly slideHeight: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
  readonly sweepViews: number;
  readonly lookupNumber: number;
}

export interface PagingReport {
  readonly paged: boolean;
  readonly openMs: number;
  readonly usableMs: number;
  readonly firstViewChunks: number;
  readonly firstViewCells: number;
  readonly sweepMedianMs: number;
  readonly sweepP95Ms: number;
  readonly sweepMaxMs: number;
  readonly lookupMs: number;
  readonly editsSurvivedEviction: boolean;
  readonly mostResidentVertices: number;
  readonly vertexBudget: number;
  readonly afterFirstView: PagedStats;
  readonly afterSweep: PagedStats;
  readonly longestTaskMs: number;
}

export interface PagingHarness {
  run(config: PagingConfig): Promise<PagingReport>;
  heldBytes(): number;
}

declare global {
  interface Window {
    pagingHarness: PagingHarness;
  }
}

let open: PagedCells | null = null;

function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0;
}

async function run(config: PagingConfig): Promise<PagingReport> {
  const longTasks: number[] = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  }).observe({ entryTypes: ["longtask"] });

  const started = performance.now();
  const cells = await PagedCells.open(
    httpCellSource(`${config.origin}/summary`, (index) => `${config.origin}/chunk/${index}`),
  );
  open = cells;
  const openMs = performance.now() - started;

  const centreX = config.slideWidth / 2;
  const centreY = config.slideHeight / 2;
  const first = await cells.show([
    centreX - config.viewWidth / 2,
    centreY - config.viewHeight / 2,
    centreX + config.viewWidth / 2,
    centreY + config.viewHeight / 2,
  ]);
  const usableMs = performance.now() - started;
  const afterFirstView = cells.stats();

  const target = config.lookupNumber;
  cells.edits.remove(target);
  const sweepTimes: number[] = [];
  let mostResidentVertices = afterFirstView.residentVertices;
  for (let step = 0; step < config.sweepViews; step++) {
    const share = (step * 37) % config.sweepViews;
    const left = ((config.slideWidth - config.viewWidth) * share) / config.sweepViews;
    const top =
      ((config.slideHeight - config.viewHeight) * ((step * 11) % config.sweepViews)) /
      config.sweepViews;
    const before = performance.now();
    await cells.show([left, top, left + config.viewWidth, top + config.viewHeight]);
    sweepTimes.push(performance.now() - before);
    mostResidentVertices = Math.max(mostResidentVertices, cells.stats().residentVertices);
  }
  const afterSweep = cells.stats();
  const lookupStart = performance.now();
  const found = await cells.cell(target);
  const lookupMs = performance.now() - lookupStart;
  const sorted = [...sweepTimes].sort((a, b) => a - b);

  return {
    paged: cells.paged,
    openMs,
    usableMs,
    firstViewChunks: first.loaded,
    firstViewCells: afterFirstView.residentCells,
    sweepMedianMs: percentile(sorted, 0.5),
    sweepP95Ms: percentile(sorted, 0.95),
    sweepMaxMs: sorted[sorted.length - 1] ?? 0,
    lookupMs,
    editsSurvivedEviction: found?.removed === true,
    mostResidentVertices,
    vertexBudget: afterSweep.vertexBudget,
    afterFirstView,
    afterSweep,
    longestTaskMs: Math.max(0, ...longTasks),
  };
}

window.pagingHarness = {
  run,
  heldBytes: () => open?.stats().heldBytes ?? 0,
};
