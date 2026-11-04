import { type Scan, scanMagnification } from "@parfocal/ui/lib/systematic-scan";
import { useCallback, useRef, useState } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import type { Fired } from "../keys/registry.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import { nextScan, type ScanTissue } from "./tissue-scan.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

type ScanModule = Pick<ViewerModule, "coverageGrid" | "bitsetBytes" | "zoomForMagnification">;

type Host = { getBoundingClientRect(): { width: number; height: number } };

const scanKeys = ["nextarea"] as const;

function wholeSlide(module: ScanModule, engine: ViewerEngine): ScanTissue | null {
  const slide = engine.getSlide();
  if (slide === null) return null;
  const grid = module.coverageGrid(slide);
  return { grid, tissue: new Uint8Array(module.bitsetBytes(grid)).fill(255) };
}

export function useTissueScan(
  engine: ViewerEngine,
  module: ScanModule,
  host: Host,
  tissue: ScanTissue | null,
  enabled: boolean,
) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [arrived, setArrived] = useState(0);
  const latest = useRef({ scan, tissue });
  latest.current = { scan, tissue };

  const step = useCallback(() => {
    const micronsPerPixel = engine.getSlide()?.micronsPerPixel ?? null;
    const shown = latest.current.tissue ?? wholeSlide(module, engine);
    if (micronsPerPixel === null || shown === null) return;
    const { width, height } = host.getBoundingClientRect();
    if (!(width > 0) || !(height > 0)) return;
    const zoom = module.zoomForMagnification(micronsPerPixel, scanMagnification);
    const moved = nextScan(latest.current.scan, shown, { width, height }, zoom);
    latest.current.scan = moved.scan;
    setScan(moved.scan);
    if (moved.camera === null) return;
    const reached = moved.scan.step;
    void engine.flyTo(moved.camera).then((end) => {
      if (end === "arrived") setArrived(reached);
    });
  }, [engine, module, host]);

  const bindings = useBindings(["viewer"], scanKeys, enabled);
  const onFire = useCallback(
    (fired: Fired) => {
      if (fired.phase === "press") step();
    },
    [step],
  );
  useHotkeys(bindings, onFire);

  return { scan, arrived };
}
