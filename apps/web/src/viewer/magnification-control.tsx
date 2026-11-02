import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { type MagnificationLabel, presetForDigit } from "@parfocal/ui/lib/magnification-bar";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { keyRegistry } from "../keys/catalogue.ts";
import { useHotkeys } from "../keys/use-hotkeys.ts";
import type { loadViewerEngine } from "./load-engine.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type ViewerModule = Awaited<ReturnType<typeof loadViewerEngine>>;

type MagnificationControlProps = {
  engine: ViewerEngine;
  units: Pick<
    ViewerModule,
    "effectiveMagnification" | "magnificationReadout" | "micronsPerScreenPixel" | "scaleBar"
  >;
  brightness: number;
  onBrightnessChange: (value: number) => void;
  onOpenChange?: (open: boolean) => void;
  labelAs?: MagnificationLabel;
};

const scaleBarMaxPx = 96;
const brightnessStep = 10;
const hotkeyIds = ["mag", "brightup", "brightdown"] as const;

function useAltDigitHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.altKey && /^Digit[1-6]$/.test(event.code)) setHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Alt" || /^Digit[1-6]$/.test(event.code)) setHeld(false);
    };
    const release = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
    };
  }, []);
  return held;
}

export function MagnificationControl({
  engine,
  units,
  brightness,
  onBrightnessChange,
  onOpenChange,
  labelAs = "objective",
}: MagnificationControlProps) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const altHeld = useAltDigitHeld();
  const [zoomStamp, setZoomStamp] = useState(0);
  const lastZoom = useRef(camera.zoom);
  useEffect(() => {
    if (lastZoom.current === camera.zoom) return;
    lastZoom.current = camera.zoom;
    setZoomStamp((stamp) => stamp + 1);
  }, [camera.zoom]);

  const bindings = useMemo(() => keyRegistry.bindings({ scopes: ["viewer"], only: hotkeyIds }), []);
  const jumpTo = useCallback(
    (preset: number) => {
      engine.zoomToMagnification(preset);
    },
    [engine],
  );
  const onFire = useCallback(
    ({ action, phase }: { action: string; phase: string }) => {
      if (phase !== "press") return;
      if (action === "brightup") onBrightnessChange(Math.min(140, brightness + brightnessStep));
      else if (action === "brightdown")
        onBrightnessChange(Math.max(20, brightness - brightnessStep));
      else if (action.startsWith("mag:")) {
        const preset = presetForDigit(Number(action.slice(4)));
        if (preset !== null) jumpTo(preset);
      }
    },
    [brightness, jumpTo, onBrightnessChange],
  );
  useHotkeys(bindings, onFire);

  const spacing = engine.getSlide()?.micronsPerPixel ?? null;
  const magnification = units.effectiveMagnification(camera.zoom, spacing);
  const bar = units.scaleBar({
    zoom: camera.zoom,
    micronsPerPixel: spacing,
    maxWidthPx: scaleBarMaxPx,
  });
  if (spacing === null || magnification === null || bar === null) return null;
  const readout = units.magnificationReadout(camera.zoom, spacing);
  return (
    <MagnificationBar
      data-testid="magnification-bar"
      magnification={magnification}
      scaleLabel={bar.label}
      scalePx={bar.widthPx}
      micronsPerPixel={units.micronsPerScreenPixel(camera.zoom, spacing) ?? spacing}
      digital={readout.digital}
      labelAs={labelAs}
      altHeld={altHeld}
      zoomStamp={zoomStamp}
      onPreset={jumpTo}
      brightness={brightness}
      onBrightnessChange={onBrightnessChange}
      {...(onOpenChange ? { onOpenChange } : {})}
    />
  );
}
