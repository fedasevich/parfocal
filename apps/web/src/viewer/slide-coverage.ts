import {
  ApiError,
  getSlideCoverage,
  getSlideTissue,
  recordSlideCoverage,
  type SlideCoverage,
  type SlideTissue,
} from "@parfocal/api-client";
import { useEffect, useState } from "react";
import type { ViewerModule } from "./magnification-control.tsx";
import type {
  CoverageGrid,
  CoverageRaster,
  CoverageShare,
  CoverageTracker,
  TissueRaster,
  ViewerEngine,
} from "./viewer-engine.ts";

export type SlideCoverageState = {
  readonly tracker: CoverageTracker;
  readonly raster: CoverageRaster;
  readonly share: CoverageShare;
  readonly percent: number;
  readonly pending: number;
  readonly loaded: boolean;
  readonly tissue: TissueRaster | null;
};

type Host = { getBoundingClientRect(): { width: number; height: number } };

export const coverageRefusedPauseMs = 10 * 60_000;

const refusedUntil = new Map<string, number>();

export function coverageRefused(slideId: string, at: number = Date.now()): boolean {
  return (refusedUntil.get(slideId) ?? 0) > at;
}

export function noteCoverageAnswer(slideId: string, error: unknown, at: number = Date.now()): void {
  if (error instanceof ApiError && error.status === 409) {
    refusedUntil.set(slideId, at + coverageRefusedPauseMs);
  }
}

const tissueAnswers = new Map<string, Promise<SlideTissue | null>>();

export function storedTissue(slideId: string): Promise<SlideTissue | null> {
  const known = tissueAnswers.get(slideId);
  if (known !== undefined) return known;
  const asked = getSlideTissue(slideId)
    .then((response) =>
      response.status === 200 && response.data.tissue !== null ? response.data : null,
    )
    .catch((error: unknown) => {
      if (!(error instanceof ApiError && error.status === 404)) tissueAnswers.delete(slideId);
      return null;
    });
  tissueAnswers.set(slideId, asked);
  return asked;
}

function rasterOf(
  module: ViewerModule,
  grid: CoverageGrid,
  coverage: SlideCoverage,
): CoverageRaster | null {
  if (!module.sameGrid(grid, coverage.grid)) return null;
  return { grid, seen: module.decodeBits(coverage.seen, module.bitsetBytes(grid)) };
}

function tissueOf(
  module: ViewerModule,
  grid: CoverageGrid,
  stored: SlideTissue,
): TissueRaster | null {
  if (stored.tissue === null || !module.sameGrid(grid, stored.grid)) return null;
  return { grid, tissue: module.decodeBits(stored.tissue, module.bitsetBytes(grid)) };
}

export function useSlideCoverage(
  engine: ViewerEngine | null,
  module: ViewerModule | null,
  slideId: string,
  host: Host | null,
): SlideCoverageState | null {
  const [state, setState] = useState<SlideCoverageState | null>(null);

  useEffect(() => {
    const slide = engine?.getSlide() ?? null;
    if (engine === null || module === null || host === null || slide === null) return;
    const grid = module.coverageGrid(slide);
    let loaded = false;
    let tissue: TissueRaster | null = null;
    const tracker = module.createCoverageTracker({
      grid,
      micronsPerPixel: slide.micronsPerPixel,
      send: async (cells) => {
        if (coverageRefused(slideId)) return null;
        try {
          const response = await recordSlideCoverage(slideId, { grid, cells: [...cells] });
          return response.status === 200 ? rasterOf(module, grid, response.data) : null;
        } catch (error) {
          noteCoverageAnswer(slideId, error);
          if (coverageRefused(slideId)) return null;
          throw error;
        }
      },
    });
    const publish = () => {
      const share = tracker.share();
      setState({
        tracker,
        raster: tracker.raster(),
        share,
        percent: module.coveragePercent(share),
        pending: tracker.pending(),
        loaded,
        tissue,
      });
    };
    const observe = () => {
      const { width, height } = host.getBoundingClientRect();
      tracker.observe(engine.getCamera(), { width, height });
    };
    const stopTracking = tracker.subscribe(publish);
    const stopCamera = engine.subscribeCamera(observe);
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") void tracker.flush().then(publish);
    };
    document.addEventListener("visibilitychange", flushWhenHidden);
    let cancelled = false;
    storedTissue(slideId)
      .then((answer) => {
        const stored = answer === null ? null : tissueOf(module, grid, answer);
        if (cancelled || stored === null) return;
        tissue = stored;
        tracker.setTissue(stored);
      })
      .catch(() => undefined);
    const stored = coverageRefused(slideId)
      ? Promise.resolve(null)
      : getSlideCoverage(slideId).then((response) =>
          response.status === 200 ? rasterOf(module, grid, response.data) : null,
        );
    stored
      .then((raster) => {
        if (!cancelled && raster !== null) tracker.load(raster);
      })
      .catch((error: unknown) => noteCoverageAnswer(slideId, error))
      .finally(() => {
        if (cancelled) return;
        loaded = true;
        observe();
        publish();
      });
    return () => {
      cancelled = true;
      stopCamera();
      stopTracking();
      document.removeEventListener("visibilitychange", flushWhenHidden);
      void tracker.dispose();
    };
  }, [engine, module, slideId, host]);

  return state;
}
