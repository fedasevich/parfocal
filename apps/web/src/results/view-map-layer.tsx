import { Trans, useLingui } from "@lingui/react/macro";
import { useListSlideResultSets } from "@parfocal/api-client";
import { Button } from "@parfocal/ui/components/button";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useStageRect } from "../annotations/stage-size.ts";
import { okData } from "../screens/placeholder.tsx";
import {
  colorizeHeatmap,
  defaultHeatmapLook,
  defaultHeatmapOpacity,
  type HeatmapGrid,
  slideToScreen,
  type ViewerEngine,
  viewArea,
} from "../viewer/viewer-engine.ts";
import { mayBeHeatmap } from "./heatmap-layer.tsx";
import { buildViewMapSource, type ViewMapSource, viewMapScorerFor } from "./view-map-scorer.ts";
import {
  createViewMapSession,
  type ViewMapPhase,
  type ViewMapSession,
} from "./view-map-session.ts";

function gridPicture(grid: HeatmapGrid): string {
  const rgba = colorizeHeatmap(grid, defaultHeatmapLook);
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  canvas
    .getContext("2d")
    ?.putImageData(new ImageData(new Uint8ClampedArray(rgba), grid.width, grid.height), 0, 0);
  return canvas.toDataURL();
}

function PhaseText({ phase }: { phase: ViewMapPhase }) {
  if (phase === "scoring") return <Trans>Mapping this view</Trans>;
  if (phase === "too-wide") return <Trans>Zoom in to map this view</Trans>;
  if (phase === "failed") return <Trans>This view could not be mapped</Trans>;
  return null;
}

type ViewMapPanelProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  session: ViewMapSession;
};

function ViewMapPanel({ engine, stage, session }: ViewMapPanelProps) {
  const { t } = useLingui();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const rect = useStageRect(stage);
  const picture = useMemo(
    () => (state.grid === null ? null : gridPicture(state.grid)),
    [state.grid],
  );
  const area = state.grid?.area;
  const from = area === undefined ? null : slideToScreen(camera, rect, area);
  const to =
    area === undefined
      ? null
      : slideToScreen(camera, rect, { x: area.x + area.width, y: area.y + area.height });
  const ask = () => {
    void session.ask(viewArea(engine.getCamera(), { width: rect.width, height: rect.height }));
  };
  return (
    <>
      {picture === null || from === null || to === null ? null : (
        <img
          alt=""
          aria-hidden="true"
          data-testid="view-map-layer"
          data-tiles={state.map.tiles.size}
          src={picture}
          className="pointer-events-none absolute max-w-none"
          style={{
            left: from.x,
            top: from.y,
            width: to.x - from.x,
            height: to.y - from.y,
            opacity: defaultHeatmapOpacity,
          }}
        />
      )}
      <section
        aria-label={t`Tumor map for this view`}
        data-testid="view-map"
        data-phase={state.phase}
        data-tiles={state.map.tiles.size}
        className="pointer-events-auto absolute right-3 bottom-3 z-10 flex items-center gap-2 rounded-md border border-line bg-chrome px-3 py-2 text-caption shadow-sm"
      >
        <span role="status" data-testid="view-map-status">
          <PhaseText phase={state.phase} />
        </span>
        <Button
          size="sm"
          data-testid="view-map-ask"
          disabled={state.phase === "scoring"}
          onClick={ask}
        >
          {state.map.tiles.size === 0 ? (
            <Trans>Map this view</Trans>
          ) : (
            <Trans>Extend the map</Trans>
          )}
        </Button>
      </section>
    </>
  );
}

type ViewMapLayerProps = {
  engine: ViewerEngine;
  stage: HTMLElement;
  slideId: string;
};

type SlideViewMapProps = ViewMapLayerProps & {
  slide: { readonly width: number; readonly height: number };
  source: ViewMapSource;
};

function SlideViewMap({ engine, stage, slide, slideId, source }: SlideViewMapProps) {
  const [session] = useState(() => {
    const scorer = viewMapScorerFor(source, slide, slideId);
    return scorer === null ? null : createViewMapSession({ slide, scorer });
  });
  if (session === null) return null;
  return <ViewMapPanel engine={engine} stage={stage} session={session} />;
}

export function ViewMapLayer({ engine, stage, slideId }: ViewMapLayerProps) {
  const sets = okData(useListSlideResultSets(slideId).data);
  const slide = useSyncExternalStore(engine.subscribeCamera, engine.getSlide);
  const source = buildViewMapSource();
  if (sets === undefined || sets.some(mayBeHeatmap) || slide === null || source === null) {
    return null;
  }
  return (
    <SlideViewMap
      key={`${slideId}:${slide.width}x${slide.height}:${source}`}
      engine={engine}
      stage={stage}
      slide={slide}
      slideId={slideId}
      source={source}
    />
  );
}
