import { useLingui } from "@lingui/react/macro";
import {
  PaneHeader,
  PanePicker,
  type PaneSide,
  type PaneSlide,
} from "@parfocal/ui/components/viewer-tools";
import { type ReactNode, useRef } from "react";
import { type Camera, SlideStill } from "../screens/review/slide-still.tsx";
import { turnedHost } from "../screens/viewer-tools/compare-frame.ts";
import { paneName } from "../screens/viewer-tools/compare-layout.ts";
import { rotationStep } from "../screens/viewer-tools/link-camera.ts";
import type { PaneBox } from "./compare-home.tsx";
import { type StillDrawChoices, StillEngine, type StillObject } from "./still-engine.tsx";
import type { StillFrame } from "./still-frame.ts";
import { useWebglAvailable } from "./webgl.ts";

const plainSlide: StillDrawChoices = {
  draw: "outline",
  width: "normal",
  opacity: 1,
  colorBy: "class",
  cutoff: 0,
  confidence: "all",
};

const noClasses: ReadonlySet<string> = new Set();

type RotateChange = { by: number } | { to: number };

export function CompareStillPane({
  side,
  slide,
  camera,
  rotation,
  objects,
  picking,
  pickerSlides,
  onPicking,
  onPick,
  onCamera,
  onRotate,
  onFrame,
  onPointer,
  overlay,
}: {
  side: PaneSide;
  slide: PaneSlide & { id: string };
  camera: Camera | null;
  rotation: number;
  objects: readonly StillObject[] | null;
  picking: boolean;
  pickerSlides: Parameters<typeof PanePicker>[0]["slides"];
  onPicking: (open: boolean) => void;
  onPick: (id: string) => void;
  onCamera: (camera: Camera | null) => void;
  onRotate: (shown: Camera, change: RotateChange) => void;
  onFrame: (frame: StillFrame | undefined) => void;
  onPointer: (camera: Camera, box: PaneBox, at: { x: number; y: number }) => void;
  overlay: (camera: Camera, box: PaneBox) => ReactNode;
}) {
  const { t } = useLingui();
  const webgl = useWebglAvailable();
  const name = paneName[side];
  const shown = useRef<{ camera: Camera | null; box: PaneBox }>({
    camera: null,
    box: { width: 0, height: 0 },
  });
  return (
    <section
      data-pane={side}
      className="relative flex min-h-0 min-w-0 overflow-hidden bg-canvas"
      aria-label={`${name[0]?.toUpperCase()}${name.slice(1)}: ${slide.name}`}
      onPointerMove={(event) => {
        const now = shown.current;
        if (now.camera === null) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onPointer(now.camera, now.box, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      }}
    >
      <div className="absolute inset-0 flex">
        <SlideStill
          view={{ kind: "whole" }}
          rotation={rotation}
          backdrop={
            webgl
              ? ({ camera: drawn, size, onReady, onTiles }) => (
                  <div
                    data-testid="engine-turn"
                    data-rotation={rotation}
                    className="pointer-events-none absolute"
                    style={turnedHost(rotation, size)}
                  >
                    <StillEngine
                      key={slide.id}
                      slideId={slide.id}
                      camera={drawn}
                      objects={objects}
                      choices={plainSlide}
                      hiddenClasses={noClasses}
                      onReady={(ready) => {
                        onReady(ready);
                        onFrame(ready?.frame);
                      }}
                      onTiles={onTiles}
                    />
                  </div>
                )
              : undefined
          }
          overlay={({ camera: drawn, size }) => {
            shown.current.camera = drawn;
            shown.current.box = size;
            return (
              <>
                {overlay(drawn, size)}
                <fieldset
                  aria-label={t`Rotate ${name} pane`}
                  className="absolute right-3 bottom-16 m-0 flex min-w-0 items-center gap-1 rounded-full border-0 bg-black/60 px-1.5 py-1 text-body-sm text-white"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    aria-label={t`Rotate ${name} pane left`}
                    className="min-h-6 min-w-6 rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => onRotate(drawn, { by: -rotationStep })}
                  >
                    ↺
                  </button>
                  <span data-testid={`rotation-${side}`} className="min-w-9 text-center font-mono">
                    {rotation}°
                  </span>
                  <button
                    type="button"
                    aria-label={t`Rotate ${name} pane right`}
                    className="min-h-6 min-w-6 rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => onRotate(drawn, { by: rotationStep })}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    aria-label={t`Reset ${name} pane rotation to 0°`}
                    className="min-h-6 min-w-6 rounded-full px-2 py-0.5 hover:bg-white/15"
                    onClick={() => onRotate(drawn, { to: 0 })}
                  >
                    0°
                  </button>
                </fieldset>
              </>
            );
          }}
          camera={camera}
          onCameraChange={onCamera}
          regionDecisions={{}}
          bare
          minimap={false}
          hint={false}
        />
      </div>
      <PaneHeader side={side} slide={slide} open={picking} onOpenChange={onPicking} />
      {picking ? <PanePicker side={side} onPick={onPick} slides={pickerSlides} /> : null}
    </section>
  );
}
