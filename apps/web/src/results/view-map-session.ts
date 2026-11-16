import {
  askViewMap,
  createViewMap,
  type HeatmapGrid,
  planViewMap,
  type SlideArea,
  type ViewMap,
  type ViewMapScorer,
  viewMapGrid,
  viewMapLayout,
  viewMapMaxTilesPerAsk,
} from "@parfocal/viewer-engine";

export type ViewMapPhase = "empty" | "scoring" | "ready" | "too-wide" | "failed";

export interface ViewMapState {
  readonly phase: ViewMapPhase;
  readonly map: ViewMap;
  readonly grid: HeatmapGrid | null;
}

export interface ViewMapSession {
  readonly getState: () => ViewMapState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly ask: (view: SlideArea) => Promise<void>;
}

export interface ViewMapSessionOptions {
  readonly slide: { readonly width: number; readonly height: number };
  readonly scorer: ViewMapScorer;
  readonly cell?: number;
  readonly maxTiles?: number;
}

export function createViewMapSession(options: ViewMapSessionOptions): ViewMapSession {
  const maxTiles = options.maxTiles ?? viewMapMaxTilesPerAsk;
  const listeners = new Set<() => void>();
  let state: ViewMapState = {
    phase: "empty",
    map: createViewMap(viewMapLayout(options.slide, options.cell)),
    grid: null,
  };
  const settle = (phase: ViewMapPhase, map: ViewMap) => {
    state = { phase, map, grid: map === state.map ? state.grid : viewMapGrid(map) };
    for (const listener of listeners) listener();
  };
  const restingPhase = (map: ViewMap): ViewMapPhase => (map.tiles.size === 0 ? "empty" : "ready");
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ask: async (view) => {
      if (state.phase === "scoring") return;
      const plan = planViewMap(state.map, view, maxTiles);
      if (plan.tooWide) {
        settle("too-wide", state.map);
        return;
      }
      if (plan.missing.length === 0) {
        settle(restingPhase(state.map), state.map);
        return;
      }
      settle("scoring", state.map);
      try {
        const map = await askViewMap(state.map, view, options.scorer, {
          maxTiles,
          onTile: (partial) => settle("scoring", partial),
        });
        settle("ready", map);
      } catch {
        settle("failed", state.map);
      }
    },
  };
}
