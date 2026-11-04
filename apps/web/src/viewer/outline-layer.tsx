import { useEffect, useMemo } from "react";
import type { ViewerModule } from "./magnification-control.tsx";
import type { OutlineModeChoice } from "./outline-mode.ts";
import { sampleOutlines } from "./sample-outlines.ts";
import type { ScanTissue } from "./tissue-scan.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const overlayId = "model-outlines";

function signatureOf(colors: readonly (Uint8Array | undefined)[]): string {
  let hash = 0;
  for (const part of colors) {
    if (part === undefined) continue;
    for (const byte of part) hash = (hash * 31 + byte) >>> 0;
  }
  return hash.toString(16);
}

export function OutlineLayer({
  engine,
  module,
  mode,
  tissue,
}: {
  engine: ViewerEngine;
  module: ViewerModule;
  mode: OutlineModeChoice;
  tissue: ScanTissue | null;
}) {
  const slide = engine.getSlide();
  const outlines = useMemo(() => {
    if (slide === null) return [];
    return sampleOutlines(tissue?.grid ?? module.coverageGrid(slide), tissue);
  }, [slide, tissue, module]);
  const overlays = useMemo(
    () => module.outlineModeOverlays({ id: overlayId, mode, outlines }),
    [module, mode, outlines],
  );
  useEffect(() => {
    const controller = module.createOverlayController(engine);
    for (const overlay of overlays) controller.set(overlay);
    return () => controller.clear();
  }, [engine, module, overlays]);
  return (
    <div
      hidden
      data-testid="outline-layer"
      data-mode={mode}
      data-overlays={overlays.length}
      data-outlines={outlines.length}
      data-signature={signatureOf(overlays.map((overlay) => overlay.shapes.polygons?.colors))}
    />
  );
}
