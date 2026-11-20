import { useLingui } from "@lingui/react/macro";
import { PaneHeader, PanePicker, type PaneSlide } from "@parfocal/ui/components/viewer-tools";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Camera } from "../screens/review/slide-still.tsx";
import { overviewFrame, type StillFrame, stillCameraOf } from "./still-frame.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

export type PaneBox = { width: number; height: number };

export type HomePaneLink = {
  readonly slide: PaneSlide | undefined;
  readonly picking: boolean;
  readonly pickerSlides: Parameters<typeof PanePicker>[0]["slides"];
  readonly onPicking: (open: boolean) => void;
  readonly onPick: (id: string) => void;
  readonly onPointer: (camera: Camera, box: PaneBox, at: { x: number; y: number } | null) => void;
  readonly overlay: (camera: Camera, box: PaneBox) => ReactNode;
};

const noCamera = () => () => {};

export function homeFrameOf(engine: ViewerEngine | null): StillFrame | null {
  const slide = engine?.getSlide() ?? null;
  return slide === null ? null : overviewFrame(slide);
}

export function homeCameraOf(engine: ViewerEngine): Camera | null {
  const frame = homeFrameOf(engine);
  return frame === null ? null : stillCameraOf(engine.getCamera(), frame);
}

export function CompareHomePane({
  engine,
  link,
}: {
  engine: ViewerEngine | null;
  link: HomePaneLink;
}) {
  const { t } = useLingui();
  const box = useRef<HTMLElement>(null);
  const [size, setSize] = useState<PaneBox>({ width: 0, height: 0 });
  const subscribe = engine?.subscribeCamera ?? noCamera;
  const engineCamera = useSyncExternalStore(subscribe, () => engine?.getCamera() ?? null);
  const camera = engine !== null && engineCamera !== null ? homeCameraOf(engine) : null;
  const latest = useRef({ camera, size, onPointer: link.onPointer });
  latest.current = { camera, size, onPointer: link.onPointer };
  useEffect(() => {
    const node = box.current;
    if (node === null) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const stage = node.parentElement;
    const onMove = (event: PointerEvent) => {
      const now = latest.current;
      if (now.camera === null || stage === null) return;
      const rect = stage.getBoundingClientRect();
      now.onPointer(now.camera, now.size, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    stage?.addEventListener("pointermove", onMove);
    return () => {
      observer.disconnect();
      stage?.removeEventListener("pointermove", onMove);
    };
  }, []);
  return (
    <section
      ref={box}
      data-slot="compare-home"
      className="pointer-events-none absolute inset-0 z-10"
      aria-label={link.slide ? t`Left: ${link.slide.name}` : undefined}
    >
      {camera === null || size.width === 0 ? null : link.overlay(camera, size)}
      {link.slide === undefined ? null : (
        <div className="pointer-events-auto">
          <PaneHeader
            side="left"
            slide={link.slide}
            open={link.picking}
            onOpenChange={link.onPicking}
          />
          {link.picking ? (
            <PanePicker side="left" onPick={link.onPick} slides={link.pickerSlides} />
          ) : null}
        </div>
      )}
    </section>
  );
}
