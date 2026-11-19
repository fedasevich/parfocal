import { useLingui } from "@lingui/react/macro";
import { Button } from "@parfocal/ui/components/button";
import { Icon } from "@parfocal/ui/components/icon";
import { formatMagnification } from "@parfocal/ui/lib/magnification-bar";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { ViewerModule } from "./magnification-control.tsx";
import type { StageArea } from "./stage-geometry.ts";
import type { ViewerEngine } from "./viewer-engine.ts";
import { WholeSlideButton } from "./whole-slide-button.tsx";

const movedScreenPx = 24;
const zoomStepOctaves = 0.5;

function useViewState(
  engine: ViewerEngine,
  module: ViewerModule,
  area: StageArea | null,
): { moved: boolean; readout: string | null } {
  const read = useCallback(() => {
    const camera = engine.getCamera();
    const spacing = engine.getSlide()?.micronsPerPixel ?? null;
    const magnification = module.effectiveMagnification(camera.zoom, spacing);
    const readout = magnification === null ? "" : formatMagnification(magnification);
    let moved = false;
    if (area !== null) {
      const scale = 2 ** camera.zoom;
      moved =
        Math.abs(camera.x - (area.x + area.width / 2)) * scale > movedScreenPx ||
        Math.abs(camera.y - (area.y + area.height / 2)) * scale > movedScreenPx;
    }
    return `${moved ? 1 : 0}|${readout}`;
  }, [engine, module, area]);
  const snapshot = useSyncExternalStore(engine.subscribeCamera, read, read);
  const split = snapshot.indexOf("|");
  const readout = snapshot.slice(split + 1);
  return { moved: snapshot.startsWith("1"), readout: readout === "" ? null : readout };
}

export function StageGuidedView({
  engine,
  module,
  object,
  area,
  finished,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  object: string;
  area: StageArea | null;
  finished: boolean;
}) {
  const { t } = useLingui();
  const { moved, readout } = useViewState(engine, module, area);
  const [whole, setWhole] = useState(false);
  const centre = () => {
    setWhole(false);
    if (area !== null) void engine.flyToArea(area);
  };
  const toggleWhole = () => {
    if (whole) {
      centre();
      return;
    }
    setWhole(true);
    void engine.flyToFit();
  };
  return (
    <>
      {finished || moved ? null : (
        <span
          data-testid="stage-pan-hint"
          data-minimap-block
          className="pointer-events-none absolute top-4 left-4 z-3 inline-flex h-8 items-center gap-2 rounded-full bg-[rgb(17_17_17/0.72)] px-3 text-body-sm font-medium text-white"
        >
          <Icon name="hand" />
          {t`Drag to move, scroll to zoom`}
        </span>
      )}
      <div
        data-testid="stage-guided-view"
        data-minimap-block
        data-moved={moved}
        className="absolute bottom-4 left-4 z-4 flex items-center gap-2"
      >
        {finished ? null : (
          <Button
            size="lg"
            variant={moved ? "primary" : "secondary"}
            title={t`Center ${object} again`}
            onClick={centre}
          >
            <Icon name="target" />
            {t`Back to ${object}`}
          </Button>
        )}
        <fieldset
          aria-label={t`Zoom`}
          className="m-0 flex h-10 items-center gap-1 rounded-ctl border border-line-strong bg-chrome px-1"
        >
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t`Zoom out`}
            title={t`Zoom out (−)`}
            onClick={() => engine.zoomBy(-zoomStepOctaves)}
          >
            <Icon name="minus" />
          </Button>
          <span
            data-testid="stage-guided-readout"
            title={t`Magnification on screen`}
            className="min-w-10 text-center text-body-sm font-medium tabular-nums"
          >
            {readout}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t`Zoom in`}
            title={t`Zoom in (+)`}
            onClick={() => engine.zoomBy(zoomStepOctaves)}
          >
            <Icon name="plus" />
          </Button>
        </fieldset>
        <WholeSlideButton
          pressed={whole}
          title={whole ? t`Back to ${object}` : t`See the whole slide`}
          onClick={toggleWhole}
        />
      </div>
    </>
  );
}
