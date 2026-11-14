import { Trans, useLingui } from "@lingui/react/macro";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
import { inspectorTabLabels, inspectorTabOrder } from "@parfocal/ui/lib/inspector-tabs";
import type { MapRect } from "@parfocal/ui/lib/minimap-box";
import { overviewSize } from "../screens/review/slide-geometry.ts";
import { lookUrl } from "../screens/thumbnails.ts";
import { usePopoutState } from "./popout-channel.ts";

const overviewImage = {
  src: lookUrl("overview"),
  width: overviewSize.width,
  height: overviewSize.height,
};

const slideExtent: MapRect = [0, 0, overviewSize.width, overviewSize.height];

export function PopoutScreen() {
  const { t } = useLingui();
  const { viewport, magnification, moveTo, inspector, selectTab } = usePopoutState();
  const kind = new URLSearchParams(window.location.search).get("kind");
  const showsInspector = kind === "inspector";
  return (
    <main className="relative min-h-screen bg-bg p-4 text-fg" data-testid="popout-window">
      <h1 className="font-semibold text-section-title">
        <Trans>Second monitor</Trans>
      </h1>
      <p
        className="text-body text-fg-dim"
        data-testid="popout-status"
        data-following={showsInspector ? inspector !== null : viewport !== null}
      >
        {(showsInspector ? inspector === null : viewport === null)
          ? t`Waiting for the main window`
          : t`Following the main window`}
      </p>
      {showsInspector && inspector !== null ? (
        <div role="tablist" className="mt-4 flex gap-2" data-testid="popout-tabs">
          {inspectorTabOrder.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={inspector.tab === name}
              onClick={() => selectTab(name)}
              className="cursor-pointer rounded-ctl border border-line bg-chrome px-3 py-1.5 text-body-sm aria-selected:border-accent aria-selected:font-semibold"
            >
              {inspectorTabLabels[name]}
              {inspector.counts[name] ? ` ${inspector.counts[name]}` : ""}
            </button>
          ))}
        </div>
      ) : null}
      {showsInspector || viewport === null ? null : (
        <>
          <p className="mt-2 text-body" data-testid="popout-readout">
            {t`${magnification.toFixed(1)}× at ${Math.round(viewport[0])}, ${Math.round(viewport[1])}`}
          </p>
          <SmartMinimap
            size="full"
            image={overviewImage}
            extent={slideExtent}
            viewport={viewport}
            title={t`Whole slide`}
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
