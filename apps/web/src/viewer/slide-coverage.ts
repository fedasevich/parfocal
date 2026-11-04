import {
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
  if (!module.sameGrid(grid, stored.grid)) return null;
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
        const response = await recordSlideCoverage(slideId, { grid, cells: [...cells] });
        return response.status === 200 ? rasterOf(module, grid, response.data) : null;
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
    getSlideTissue(slideId)
      .then((response) => {
        const stored = response.status === 200 ? tissueOf(module, grid, response.data) : null;
        if (cancelled || stored === null) return;
        tissue = stored;
        tracker.setTissue(stored);
      })
      .catch(() => undefined);
    getSlideCoverage(slideId)
      .then((response) => {
        const stored = response.status === 200 ? rasterOf(module, grid, response.data) : null;
        if (!cancelled && stored !== null) tracker.load(stored);
      })
      .catch(() => undefined)
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
