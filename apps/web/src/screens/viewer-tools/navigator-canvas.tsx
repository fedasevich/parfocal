import { MagnificationBar } from "@parfocal/ui/components/magnification-bar";
import {
  MapDots,
  MapOutline,
  MapRoute,
  MapTrail,
  MapViewport,
  SmartMinimap,
} from "@parfocal/ui/components/smart-minimap";
import { CellHud, DistanceCue, RulerLine } from "@parfocal/ui/components/viewer-tools";
import { useState } from "react";
import { regionShapes } from "../review/slide-geometry.ts";
import { type Camera, SlideStill } from "../review/slide-still.tsx";
import type { SceneOf } from "../scenes.ts";
import { lookUrl } from "../thumbnails.ts";
import { cueStyle } from "./edge-cues.ts";
import { placeMinimap } from "./minimap-placement.ts";
import { avoidRuler, mapBoxOf, navigatorLookOf, navigatorSpots } from "./minimap-scenes.ts";
import { type AreaMark, boxCentre, MinimapAreas, viewportOf } from "./slide-maps.tsx";
import {
  areaTwoCells,
  cellsUnderReview,
  midEdge,
  seenPercent,
  seenTrail,
} from "./tool-geometry.ts";
import { HeldCorner } from "./use-held-corner.tsx";

export type NavigatorScene = SceneOf<"navigator">;

const overviewImage = { src: lookUrl("overview"), width: 1400, height: 1924 };

const lookOf = navigatorLookOf;

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
        const spots = navigatorSpots(scene, shown, size, {
          areaObjects: areas.map((area) => area.object),
          current,
          barOpen,
        });
        const { cues, size: mapSize, extent } = spots;
        const ruler = avoidRuler(size);
        const extra =
          scene === "avoid" ? (
            <RulerLine from={ruler.from} to={ruler.to} label="1.62 mm" />
          ) : scene === "focus" ? (
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
          ) : null;
        const fresh = placeMinimap(size, mapBoxOf(spots), spots.hot, spots.blocked);
        const target = regionShapes.T3;
        const here: [number, number] = [
          viewport[0] + viewport[2] / 2,
          viewport[1] + viewport[3] / 2,
        ];
        return (
          <>
            {cues.map((cue) => (
              <DistanceCue
                key={cue.object}
                data-side={cue.side}
                label={cue.label}
                distance={`${cue.mm.toFixed(1)} mm`}
                direction={cue.direction}
                active={scene === "travel" && cue.direction === "next"}
                style={cueStyle(cue)}
                onClick={
                  cue.direction === "next" && scene !== "travel"
                    ? onTravel
                    : () => onGoTo(cue.object)
                }
              />
            ))}
            {extra}
            <HeldCorner fresh={fresh} camera={shown}>
              {(place) => (
                <SmartMinimap
                  data-corner={place.corner}
                  size={mapSize}
                  image={overviewImage}
                  extent={extent}
                  faded={scene === "pointer"}
                  title={
                    scene === "travel" ? (
                      <>
                        <b>Going to area 3</b> ·{" "}
                        {(cues.find((cue) => cue.direction === "next")?.mm ?? 0).toFixed(1)} mm
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
              )}
            </HeldCorner>
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
