import { useEffect, useMemo, useState } from "react";
import { drawChoicesOf } from "../screens/review/display-tab.tsx";
import type { ViewerModule } from "./magnification-control.tsx";
import { sampleOutlines } from "./sample-outlines.ts";
import { useStageDisplay } from "./stage-display.tsx";
import type { ScanTissue } from "./tissue-scan.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "task-objects";

export function ObjectDrawLayer({
  engine,
  module,
  taskId,
  tissue,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  taskId: string;
  tissue: ScanTissue | null;
}) {
  const slide = engine.getSlide();
  const settings = useStageDisplay(taskId);
  const objects = useMemo(() => {
    if (slide === null) return [];
    return sampleOutlines(tissue?.grid ?? module.coverageGrid(slide), tissue).map(
      (outline, index) => ({
        id: `sample-${index}`,
        kind: "region" as const,
        ring: outline.ring,
        className: outline.className,
        score: outline.top,
      }),
    );
  }, [slide, tissue, module]);
  const drawing = useMemo(
    () => module.createObjectDrawing({ id: overlayId, host: engine }),
    [module, engine],
  );
  useEffect(() => () => drawing.clear(), [drawing]);
  const [drawn, setDrawn] = useState({ overlays: 0, below: 0 });
  useEffect(() => {
    drawing.setObjects(objects);
    drawing.setChoices(drawChoicesOf(settings));
    const result = drawing.result();
    setDrawn({ overlays: result?.overlays.length ?? 0, below: result?.belowCutoff.length ?? 0 });
  }, [drawing, objects, settings]);
  return (
    <div
      hidden
      data-testid="object-draw-layer"
      data-draw={settings.draw}
      data-width={settings.width}
      data-opacity={settings.opacity}
      data-color-by={settings.colorBy}
      data-cutoff={settings.cutoff}
      data-ids={settings.ids}
      data-objects={objects.length}
      data-overlays={drawn.overlays}
      data-below-cutoff={drawn.below}
    />
  );
}
