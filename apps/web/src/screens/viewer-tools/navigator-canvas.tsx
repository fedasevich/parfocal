import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import {
  MapDots,
  MapOutline,
  type MapRect,
  MapRoute,
  MapTrail,
  MapViewport,
  type MinimapSize,
  minimapBox,
  SmartMinimap,
} from "@parfocal/ui/components/smart-minimap";
import { CellHud, DistanceCue, RulerLine } from "@parfocal/ui/components/viewer-tools";
import { magnificationBarRect } from "@parfocal/ui/lib/magnification-bar";
import { useState } from "react";
import { hpfSize, regionShapes } from "../review/slide-geometry.ts";
import { type Camera, midSize, SlideStill, type StillLook } from "../review/slide-still.tsx";
import type { SceneOf } from "../scenes.ts";
import { lookUrl } from "../thumbnails.ts";
import { type HotSpot, pathPoints, placeMinimap, type ScreenRect } from "./minimap-placement.ts";
import {
  type AreaMark,
  areaExtent,
  boxCentre,
  MinimapAreas,
  toScreen,
  viewportOf,
} from "./slide-maps.tsx";
import {
  areaTwoCells,
  cellsUnderReview,
  distanceMm,
  midEdge,
  seenPercent,
  seenTrail,
} from "./tool-geometry.ts";
import { coverHome, type Size } from "./tool-maths.ts";

export type NavigatorScene = SceneOf<"navigator">;

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

const edgePoints = pathPoints(midEdge);

const readingCentre: [number, number] = [700, 520];

type Look = { look: StillLook; home: (size: Size) => Camera; magnification: number };

const looks: Record<"reading" | "cells" | "focus", Look> = {
  reading: { look: "mid", home: coverHome(midSize, readingCentre), magnification: 10 },
  cells: {
    look: "hpf",
    home: coverHome(hpfSize, [cellsUnderReview[4]?.x ?? 800, cellsUnderReview[4]?.y ?? 500], 1.05),
    magnification: 40,
  },
  focus: {
    look: "hpf",
    home: coverHome(
      hpfSize,
      [cellsUnderReview[5]?.x ?? 800, (cellsUnderReview[5]?.y ?? 540) - 40],
      2.1,
    ),
    magnification: 40,
  },
};

const lookOf = (scene: NavigatorScene) =>
  scene === "cells" ? looks.cells : scene === "focus" ? looks.focus : looks.reading;

type NavigatorCanvasProps = {
  scene: Exclude<NavigatorScene, "overview">;
  areas: AreaMark[];
  decided: number;
  current: string;
  onPeek: () => void;
  onTravel: () => void;
  onGoTo: (object: string) => void;
  onPopOut: () => void;
};

export function NavigatorCanvas({
  scene,
  areas,
  decided,
  current,
  onPeek,
  onTravel,
  onGoTo,
  onPopOut,
}: NavigatorCanvasProps) {
  const [camera, setCamera] = useState<Camera | null>(null);
  const [barOpen, setBarOpen] = useState(false);
  const setup = lookOf(scene);
  const reading = setup.look === "mid";
  const cellAt = scene === "focus" ? cellsUnderReview[5] : cellsUnderReview[4];
  return (
    <SlideStill
      view={{ kind: "whole" }}
      look={setup.look}
      homeOf={setup.home}
      camera={camera}
      onCameraChange={setCamera}
      regionDecisions={{}}
      bare
      minimap={false}
      hint={false}
      underlay={() =>
        reading ? (
          <path d={midEdge} fill="none" stroke="var(--c-tumor)" strokeWidth={3} />
        ) : cellAt ? (
          <circle
            cx={cellAt.x}
            cy={cellAt.y}
            r={scene === "focus" ? 30 : 34}
            fill="none"
            stroke="#fff"
            strokeWidth={scene === "focus" ? 2 : 3}
            strokeDasharray={scene === "focus" ? "6 5" : "8 6"}
            vectorEffect="non-scaling-stroke"
          />
        ) : null
      }
      overlay={({ camera: shown, size }) => {
        const viewport = viewportOf(setup.look, shown, size);
        const blocked: ScreenRect[] = [
          magnificationBarRect(size, { open: barOpen, brightnessChanged: false }),
        ];
        const hot: HotSpot[] = [];
        let mapSize: MinimapSize = "full";
        let extent: MapRect | undefined;
        let extra = null;
        if (reading) {
          for (const point of edgePoints) {
            const at = toScreen(shown, size, point);
            hot.push([at.x, at.y, 3]);
          }
          blocked.push(
            [12, size.height * 0.58 - 20, 260, 44],
            [size.width - 250, size.height * 0.18 - 6, 240, 40],
          );
          if (scene === "travel") mapSize = "travel";
          if (scene === "avoid") {
            const from = { x: size.width - 330, y: size.height - 190 };
            const to = { x: size.width - 95, y: size.height - 130 };
            for (let step = 0; step <= 1; step += 0.1)
              hot.push([from.x + (to.x - from.x) * step, from.y + (to.y - from.y) * step, 200]);
            extra = <RulerLine from={from} to={to} label="1.62 mm" />;
          }
        } else {
          mapSize = scene === "focus" ? "pip" : "compact";
          extent = areaExtent("T2");
          if (cellAt) {
            const at = toScreen(shown, size, [cellAt.x, cellAt.y]);
            hot.push([at.x, at.y, 50]);
          }
          if (scene === "focus") {
            blocked.push([size.width / 2 - 290, size.height - 192, 580, 120]);
            extra = (
              <CellHud
                title={'Cell 6 of 12 · AI says "tumor or immune"'}
                where="area 2"
                keys={[
                  { key: "K", label: "Keep", main: true },
                  { key: "1", label: "tumor" },
                  { key: "3", label: "immune" },
                  { key: "J", label: "skip" },
                ]}
              />
            );
          }
        }
        const box = minimapBox(
          mapSize,
          extent ?? [0, 0, overviewImage.width, overviewImage.height],
        );
        const place = placeMinimap(size, box, hot, blocked);
        const target = regionShapes.T3;
        const here: [number, number] = [
          viewport[0] + viewport[2] / 2,
          viewport[1] + viewport[3] / 2,
        ];
        return (
          <>
            {reading ? (
              <>
                <DistanceCue
                  label="T1"
                  distance={`${distanceMm.T1.toFixed(1)} mm`}
                  direction="back"
                  style={{ left: 14, bottom: "42%" }}
                  onClick={() => onGoTo("T1")}
                />
                <DistanceCue
                  label="Area 3"
                  distance={`${distanceMm.T3.toFixed(1)} mm`}
                  direction="next"
                  active={scene === "travel"}
                  style={{ right: 14, top: "18%" }}
                  onClick={scene === "travel" ? () => onGoTo("T3") : onTravel}
                />
              </>
            ) : null}
            {extra}
            <SmartMinimap
              data-corner={place.corner}
              size={mapSize}
              image={overviewImage}
              extent={extent}
              faded={scene === "pointer"}
              title={
                scene === "travel" ? (
                  <>
                    <b>Going to area 3</b> · {distanceMm.T3.toFixed(1)} mm
                  </>
                ) : (
                  <>
                    <b>Whole slide</b> · {seenPercent.reading}% seen
                  </>
                )
              }
              foot={
                reading
                  ? scene === "travel"
                    ? "Press ] again to skip"
                    : `${current} of ${areas.length}`
                  : "Area 2"
              }
              footEnd={
                reading
                  ? scene === "travel"
                    ? ""
                    : `10× · ${decided} of ${areas.length} decided`
                  : `${scene === "focus" ? 5 : 4} of 12 checked`
              }
              onOpen={onPeek}
              onPopOut={onPopOut}
              style={{ left: place.x, top: place.y }}
            >
              {reading ? (
                <>
                  <MapTrail rects={seenTrail} />
                  <MinimapAreas areas={areas} checked={["T1"]} current={current} />
                  {scene === "travel" && target ? (
                    <MapRoute from={here} to={boxCentre(target.box)} />
                  ) : null}
                </>
              ) : (
                <>
                  <MapOutline path={regionShapes.T2?.path ?? ""} />
                  <MapDots
                    dots={areaTwoCells}
                    done={scene === "focus" ? 5 : 4}
                    current={scene === "focus" ? 5 : 4}
                  />
                </>
              )}
              {scene === "focus" ? null : <MapViewport rect={viewport} />}
            </SmartMinimap>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <MagnificationBar
                magnification={setup.magnification}
                scaleLabel={reading ? "100 µm" : "10 µm"}
                scalePx={92}
                micronsPerPixel={reading ? 1.13 : 0.14}
                onOpenChange={setBarOpen}
              />
            </div>
          </>
        );
      }}
    />
  );
}

export function OverviewCanvas({ areas, checked }: { areas: AreaMark[]; checked: string[] }) {
  const [camera, setCamera] = useState<Camera | null>(null);
  return (
    <SlideStill
      view={{ kind: "whole" }}
      camera={camera}
      onCameraChange={setCamera}
      regionDecisions={{}}
      minimap={false}
      hint={false}
      tags={areas.map((area) => ({
        object: area.object,
        text: checked.includes(area.object) ? "✓" : area.object,
        color: checked.includes(area.object) ? "#15803d" : "#ffffff",
      }))}
      underlay={() => <MapTrail rects={seenTrail} opacity={0.25} />}
      overlay={() => (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <MagnificationBar
            magnification={1.25}
            scaleLabel="5 mm"
            scalePx={92}
            micronsPerPixel={33.87}
          />
        </div>
      )}
    />
  );
}
