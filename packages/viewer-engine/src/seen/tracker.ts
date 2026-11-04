import type { Camera, Viewport } from "../camera/camera.ts";
import type { MicronsPerPixel } from "../camera/units.ts";
import type { Unsubscribe } from "../engine/types.ts";
import {
  type CoverageGrid,
  type CoverageRaster,
  type CoverageShare,
  cellsInArea,
  coverageShare,
  emptyCoverage,
  markCells,
  mergeCoverage,
  seesCoverage,
  type TissueRaster,
  viewArea,
} from "./coverage.ts";

export const coverageFlushMs = 4000;
export const coverageBatchLimit = 4096;

export interface CoverageTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: CoverageTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type CoverageSend = (cells: readonly number[]) => Promise<CoverageRaster | null>;

export interface CoverageTrackerOptions {
  readonly grid: CoverageGrid;
  readonly micronsPerPixel: MicronsPerPixel;
  readonly send: CoverageSend;
  readonly initial?: CoverageRaster | null;
  readonly tissue?: TissueRaster | null;
  readonly flushMs?: number;
  readonly batchLimit?: number;
  readonly timers?: CoverageTimers;
}

export interface CoverageTracker {
  readonly observe: (camera: Camera, viewport: Viewport) => number;
  readonly raster: () => CoverageRaster;
  readonly share: () => CoverageShare;
  readonly pending: () => number;
  readonly load: (raster: CoverageRaster) => void;
  readonly setTissue: (tissue: TissueRaster | null) => void;
  readonly flush: () => Promise<void>;
  readonly subscribe: (listener: () => void) => Unsubscribe;
  readonly dispose: () => Promise<void>;
}

export function createCoverageTracker(options: CoverageTrackerOptions): CoverageTracker {
  const timers = options.timers ?? browserTimers;
  const flushMs = options.flushMs ?? coverageFlushMs;
  const batchLimit = Math.max(1, options.batchLimit ?? coverageBatchLimit);
  const raster = emptyCoverage(options.grid);
  if (options.initial) mergeCoverage(raster, options.initial);
  let tissue = options.tissue ?? null;
  let queued: number[] = [];
  let timer: unknown = null;
  let sending: Promise<void> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const schedule = () => {
    if (timer !== null || disposed || queued.length === 0) return;
    timer = timers.set(() => {
      timer = null;
      void flush();
    }, flushMs);
  };

  const sendOnce = async () => {
    const batch = queued.slice(0, batchLimit);
    queued = queued.slice(batch.length);
    try {
      const answer = await options.send(batch);
      if (answer !== null) mergeCoverage(raster, answer);
    } catch {
      queued = [...batch, ...queued];
      return false;
    }
    notify();
    return true;
  };

  const flush = async (): Promise<void> => {
    if (sending !== null) {
      await sending;
      if (queued.length === 0) return;
    }
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
    sending = (async () => {
      while (queued.length > 0) {
        if (!(await sendOnce())) break;
      }
    })();
    try {
      await sending;
    } finally {
      sending = null;
      schedule();
    }
  };

  return {
    observe(camera, viewport) {
      if (disposed || !seesCoverage(camera, options.micronsPerPixel)) return 0;
      const added = markCells(raster, cellsInArea(raster.grid, viewArea(camera, viewport)));
      if (added.length === 0) return 0;
      queued.push(...added);
      notify();
      schedule();
      return added.length;
    },
    raster: () => raster,
    share: () => coverageShare(raster, tissue),
    pending: () => queued.length,
    load(other) {
      if (mergeCoverage(raster, other).length > 0) notify();
    },
    setTissue(next) {
      tissue = next;
      notify();
    },
    flush,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      if (disposed) return;
      await flush();
      disposed = true;
      if (timer !== null) timers.clear(timer);
      timer = null;
      listeners.clear();
    },
  };
}
