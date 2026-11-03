import { useCallback, useEffect, useMemo, useRef } from "react";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";
import {
  applyViewerKey,
  type SelectionArea,
  type ViewerKeyTarget,
  viewerKeyBindings,
} from "./viewer-keys.ts";

type KeyModule = Pick<ViewerModule, "createKeyPan" | "keyZoomOctaves" | "bindViewHistory">;

export function useViewerKeys(
  engine: ViewerEngine,
  module: KeyModule,
  selection?: () => SelectionArea | null,
) {
  const shift = useRef(false);
  const selected = useRef(selection);
  selected.current = selection;
  const pan = useMemo(
    () =>
      module.createKeyPan({
        panBy: (dx, dy) => {
          if (engine.status() === "mounted") engine.panBy(dx, dy);
        },
        profile: engine.getCameraProfile,
        now: () => performance.now(),
        frames: {
          request: (callback) => requestAnimationFrame(callback),
          cancel: (handle) => cancelAnimationFrame(handle),
        },
      }),
    [engine, module],
  );

  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      shift.current = event.shiftKey;
      pan.setFast(event.shiftKey);
    };
    const release = () => {
      shift.current = false;
      pan.stop();
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", track);
      window.removeEventListener("keyup", track);
      window.removeEventListener("blur", release);
      pan.stop();
    };
  }, [pan]);

  const history = useRef<ReturnType<KeyModule["bindViewHistory"]> | null>(null);
  useEffect(() => {
    const bound = module.bindViewHistory(engine);
    history.current = bound;
    return () => {
      bound.dispose();
      if (history.current === bound) history.current = null;
    };
  }, [engine, module]);

  const target = useMemo<ViewerKeyTarget>(
    () => ({
      zoomOctaves: module.keyZoomOctaves,
      zoomBy: (octaves) => engine.zoomBy(octaves),
      fit: () => void engine.flyToFit(),
      zoomToSelection: () => {
        const area = selected.current?.() ?? null;
        if (area !== null) void engine.flyToSelection(area);
      },
      zoomToMagnification: (magnification) => engine.zoomToMagnification(magnification),
      press: (direction, fast) => pan.press(direction, fast),
      release: (direction) => pan.release(direction),
      back: () => void history.current?.back(),
      forward: () => void history.current?.forward(),
    }),
    [engine, module, pan],
  );
  const bindings = useMemo(() => viewerKeyBindings(), []);
  const onFire = useCallback(
    (fired: Parameters<typeof applyViewerKey>[0]) => applyViewerKey(fired, target, shift.current),
    [target],
  );
  useHotkeys(bindings, onFire);
}
