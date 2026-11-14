import { Trans, useLingui } from "@lingui/react/macro";
import { MapViewport, SmartMinimap } from "@parfocal/ui/components/smart-minimap";
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
  const { viewport, magnification, moveTo } = usePopoutState();
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
      {viewport === null ? null : (
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
