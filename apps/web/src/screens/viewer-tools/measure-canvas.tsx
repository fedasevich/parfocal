import { useLingui } from "@lingui/react/macro";
import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { RulerLine } from "@parfocal/ui/components/viewer-tools";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import type { Point, Segment } from "../../measure/ruler-maths.ts";
import type { StillFrame } from "../../viewer/still-frame.ts";
import type { SlideOutlines } from "../../viewer/use-still-objects.ts";
import { overviewSize } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { fitArea } from "./area-measure.ts";
import { type Size, toScreen } from "./tool-maths.ts";

type MeasureCanvasProps = {
  across: string;
  mm: number;
  line: Segment;
  outline: readonly Point[];
  onLine: (line: Segment) => void;
  outlines?: SlideOutlines | undefined;
  outlineFrame?: StillFrame | undefined;
};

type End = "from" | "to";

const keySteps: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

const keyStepPixels = 4;

function areaHome(outline: readonly Point[]) {
  return (view: Size): Camera =>
    fitArea(outline, view) ?? {
      x: overviewSize.width / 2,
      y: overviewSize.height / 2,
      scale: Math.min(view.width / overviewSize.width, view.height / overviewSize.height),
    };
}

const toSlide = (camera: Camera, size: Size, screen: Point): Point => ({
  x: (screen.x - size.width / 2) / camera.scale + camera.x,
  y: (screen.y - size.height / 2) / camera.scale + camera.y,
});

function RulerEnd({
  end,
  at,
  camera,
  size,
  line,
  onLine,
}: {
  end: End;
  at: Point;
  camera: Camera;
  size: Size;
  line: Segment;
  onLine: (line: Segment) => void;
}) {
  const { t } = useLingui();
  const dragging = useRef(false);
  const move = (point: Point) => onLine({ ...line, [end]: point });
  const local = (event: PointerEvent<HTMLButtonElement>): Point => {
    const box = event.currentTarget.parentElement?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = keySteps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const pixels = keyStepPixels / camera.scale;
    move({ x: line[end].x + step[0] * pixels, y: line[end].y + step[1] * pixels });
  };
  return (
    <button
      type="button"
      data-slot="ruler-end"
      data-end={end}
      aria-label={end === "from" ? t`Start of the ruler` : t`End of the ruler`}
      className="absolute size-4 -translate-1/2 cursor-grab rounded-full border-2 border-white bg-fg shadow outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => {
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (dragging.current) move(toSlide(camera, size, local(event)));
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onLostPointerCapture={() => {
        dragging.current = false;
      }}
      onKeyDown={onKeyDown}
    />
  );
}

export function MeasureCanvas({
  across,
  mm,
  line,
  outline,
  onLine,
  outlines,
  outlineFrame,
}: MeasureCanvasProps) {
  const { t } = useLingui();
  const [camera, setCamera] = useState<Camera | null>(null);
  return (
    <SlideStill
      key={across}
      view={{ kind: "whole" }}
      homeOf={areaHome(outline)}
      outlines={outlines}
      outlineFrame={outlineFrame}
      camera={camera}
      onCameraChange={setCamera}
      regionDecisions={{}}
      minimap={false}
      hint={false}
      regionStyle={(object) =>
        object === across
          ? { stroke: "var(--c-tumor)", fill: "rgb(248 113 113 / 0.15)", width: 2 }
          : { stroke: "none" }
      }
      overlay={({ camera: shown, size }) => {
        const scale = shown.scale * 1.52;
        const from = toScreen(shown, size, [line.from.x, line.from.y]);
        const to = toScreen(shown, size, [line.to.x, line.to.y]);
        const ends = { from, to };
        return (
          <>
            <RulerLine dashed from={from} to={to} label={t`${mm.toFixed(2)} mm`} />
            {(["from", "to"] as const).map((end) => (
              <RulerEnd
                key={end}
                end={end}
                at={ends[end]}
                camera={shown}
                size={size}
                line={line}
                onLine={onLine}
              />
            ))}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <MagnificationBar
                magnification={scale}
                scaleLabel="1 mm"
                scalePx={92}
                micronsPerPixel={33.87 / scale}
              />
            </div>
          </>
        );
      }}
    />
  );
}
