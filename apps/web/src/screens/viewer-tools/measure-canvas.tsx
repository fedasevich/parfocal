import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import { RulerLine } from "@parfocal/ui/components/viewer-tools";
import { useState } from "react";
import { overviewSize, regionShapes } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import { boxCentre, type Measurement, rulerEnds, type Size, toScreen } from "./tool-maths.ts";

export { type Measurement, measuredSize, rulerEnds } from "./tool-maths.ts";

function measureHome(across: string, size: number) {
  const zoom = Math.min(9, Math.max(2.2, 2.7 * (6.2 / Math.max(0.6, size))));
  const centre = boxCentre(regionShapes[across]?.box ?? [0, 0, 1400, 1924]);
  return (view: Size): Camera => ({
    x: centre[0],
    y: centre[1],
    scale:
      Math.min(view.width / overviewSize.width, view.height / overviewSize.height) * zoom * 0.62,
  });
}

export function MeasureCanvas({
  measurement,
  regionSize,
}: {
  measurement: Measurement;
  regionSize: number;
}) {
  const [camera, setCamera] = useState<Camera | null>(null);
  const [from, to] = rulerEnds(measurement.across);
  return (
    <SlideStill
      view={{ kind: "whole" }}
      homeOf={measureHome(measurement.across, regionSize)}
      camera={camera}
      onCameraChange={setCamera}
      regionDecisions={{}}
      minimap={false}
      hint={false}
      regionStyle={(object) =>
        object === measurement.across
          ? { stroke: "var(--c-tumor)", fill: "rgb(248 113 113 / 0.15)", width: 2 }
          : { stroke: "none" }
      }
      overlay={({ camera: shown, size }) => {
        const scale = shown.scale * 1.52;
        return (
          <>
            <RulerLine
              dashed
              from={toScreen(shown, size, from)}
              to={toScreen(shown, size, to)}
              label={`${measurement.mm.toFixed(2)} mm`}
            />
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
