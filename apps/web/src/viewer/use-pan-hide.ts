import { useEffect, useState } from "react";
import { useBindings } from "../keys/personal-keys.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import type { InspectorLayout, InspectorLayoutChange } from "../screens/review/inspector-layout.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

type Camera = { readonly x: number; readonly y: number };

export function movedWhileDown(start: Camera | null, now: Camera): boolean {
  if (start === null) return false;
  return start.x !== now.x || start.y !== now.y;
}

export function usePanHide(
  engine: ViewerEngine | null,
  surface: HTMLElement | null,
  layout: InspectorLayout,
): boolean {
  const [panning, setPanning] = useState(false);
  const watching = layout.hideWhilePanning && !layout.hidden;
  useEffect(() => {
    if (!watching || engine === null || surface === null) {
      setPanning(false);
      return;
    }
    let start: Camera | null = null;
    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const camera = engine.getCamera();
      start = { x: camera.x, y: camera.y };
    };
    const onUp = () => {
      start = null;
      setPanning(false);
    };
    const unsubscribe = engine.subscribeCamera(() => {
      if (movedWhileDown(start, engine.getCamera())) setPanning(true);
    });
    surface.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      unsubscribe();
      surface.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [watching, engine, surface]);
  return panning;
}

export function usePanelKey(onLayout: (change: InspectorLayoutChange) => void) {
  const bindings = useBindings(["viewer"], ["panel"]);
  useHotkeys(bindings, (fired) => {
    if (fired.phase === "press") onLayout((current) => ({ hidden: !current.hidden }));
  });
}
