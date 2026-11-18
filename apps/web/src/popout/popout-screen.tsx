import { Trans, useLingui } from "@lingui/react/macro";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import type { MapRect } from "@parfocal/ui/lib/minimap-box";
import { overviewSize } from "../screens/review/slide-geometry.ts";
import { slideThumbUrl } from "../screens/slide-thumb-url.ts";
import { FullViewer, type ViewerSearch } from "../screens/viewer/full-viewer.tsx";
import type { ViewerTab } from "../screens/viewer/viewer-scenes.ts";
import { type SlideExtent, usePopoutState } from "./popout-channel.ts";

function overviewImageOf(slideId: string, extent: SlideExtent | null) {
  const [width, height] = extent ?? [overviewSize.width, overviewSize.height];
  return { src: slideThumbUrl(slideId), width, height };
}

function slideExtentOf(extent: SlideExtent | null): MapRect {
  const [width, height] = extent ?? [overviewSize.width, overviewSize.height];
  return [0, 0, width, height];
}

type PopoutSearch = {
  kind?: "minimap" | "inspector" | undefined;
  project?: string | undefined;
  slide?: string | undefined;
  task?: string | undefined;
  scene?: ViewerSearch["scene"];
  tab?: ViewerTab | undefined;
  object?: string | undefined;
};

export function PopoutScreen({
  search,
  onSearch,
}: {
  search: PopoutSearch;
  onSearch: (change: Partial<ViewerSearch>) => void;
}) {
  const { t } = useLingui();
  const { viewport, magnification, extent, moveTo } = usePopoutState();
  if (search.kind === "inspector") {
    if (search.project === undefined || search.slide === undefined) {
      return (
        <main className="p-4 text-body text-fg-dim" data-testid="popout-window">
          <Trans>Open this window from the viewer.</Trans>
        </main>
      );
    }
    return (
      <FullViewer
        projectId={search.project}
        slideId={search.slide}
        search={{
          task: search.task,
          scene: search.scene,
          tab: search.tab,
          object: search.object,
        }}
        onSearch={onSearch}
        panelOnly
      />
    );
  }
  return (
    <main className="relative min-h-screen bg-bg p-4 text-fg" data-testid="popout-window">
      <h1 className="font-semibold text-section-title">
        <Trans>Second monitor</Trans>
      </h1>
      <p
        className="text-body text-fg-dim"
        data-testid="popout-status"
        data-following={viewport !== null}
      >
        {viewport === null ? t`Waiting for the main window` : t`Following the main window`}
      </p>
      {viewport === null || search.slide === undefined ? null : (
        <>
          <p className="mt-2 text-body" data-testid="popout-readout">
            {t`${magnification.toFixed(1)}× at ${Math.round(viewport[0])}, ${Math.round(viewport[1])}`}
          </p>
          <SmartMinimap
            size="full"
            image={overviewImageOf(search.slide, extent)}
            extent={slideExtentOf(extent)}
            viewport={viewport}
            title={t`Whole slide`}
            onOpen={() => (window.opener as Window | null)?.focus()}
            onMoveView={(centre) => moveTo([centre[0], centre[1]])}
            style={{ left: 16, top: 120 }}
          >
            <MapViewport rect={viewport} />
          </SmartMinimap>
        </>
      )}
    </main>
  );
}
