import {
  MapDots,
  MapOutline,
  type MapPoint,
  MapRoute,
  MapTrail,
  MapViewport,
  SmartMinimap,
} from "@parfocal/ui/components/smart-minimap";
import { magnificationBarRect } from "@parfocal/ui/lib/magnification-bar";
import { type MapRect, type MinimapSetting, minimapBox } from "@parfocal/ui/lib/minimap-box";
import { mapExtent, pointerDistance } from "@parfocal/ui/lib/minimap-machine";
import { useMinimap } from "@parfocal/ui/lib/use-minimap";
import { useCallback, useEffect, useRef, useState } from "react";
import { cellShapes, overviewSize, regionShapes } from "../review/slide-geometry.ts";
import {
  type Camera,
  imageOf,
  magnificationOf,
  type StillView,
  shapeKey,
} from "../review/slide-still.tsx";
import { lookUrl } from "../thumbnails.ts";
import { mmBetween } from "./edge-cues.ts";
import { minimapContent } from "./minimap-content.ts";
import { placeMinimap, type ScreenRect } from "./minimap-placement.ts";
import { heldPlacement } from "./minimap-weights.ts";
import { type AreaMark, MinimapAreas } from "./slide-maps.tsx";
import { tissueShareOnScreen } from "./tissue-share.ts";
import { seenTrail } from "./tool-geometry.ts";
import { boxCentre, fromOverview, viewportOf } from "./tool-maths.ts";

const overviewImage = {
  src: lookUrl("overview"),
  width: overviewSize.width,
  height: overviewSize.height,
};

const slideExtent: MapRect = [0, 0, overviewSize.width, overviewSize.height];

const wholeSlideButtonWidth = 140;

const toastWidth = 340;

export function ViewerMinimap({
  setting,
  view,
  camera,
  size,
  areas,
  checked,
  blockLeft,
  blockToast,
  cells,
  travelTo = null,
  onOpen,
  onPopOut,
  onMoveView,
}: {
  setting: MinimapSetting;
  view: StillView;
  camera: Camera;
  size: { width: number; height: number };
  areas: AreaMark[];
  checked: string[];
  blockLeft: boolean;
  blockToast: boolean;
  cells: { object: string; decided: boolean }[];
  travelTo?: string | null;
  onOpen: () => void;
  onPopOut: () => void;
  onMoveView: (camera: Camera) => void;
}) {
  const viewport = viewportOf(imageOf(view), camera, size);
  const tissueShare = tissueShareOnScreen(viewport);
  const magnification = magnificationOf(view, camera);
  const minimap = useMinimap(setting, { tissueShare, magnification });
  const { send } = minimap;
  useEffect(() => {
    send({ type: "CAMERA", tissueShare, magnification });
  }, [send, tissueShare, magnification]);

  const travelling = travelTo !== null;
  useEffect(() => {
    send({ type: travelling ? "TRAVEL_START" : "TRAVEL_ARRIVE" });
  }, [send, travelling]);

  const current =
    view.kind === "region"
      ? shapeKey(view.object)
      : view.kind === "cell"
        ? shapeKey(view.object.split("·")[0] ?? "T2")
        : "T2";
  const box = regionShapes[current]?.box ?? [0, 0, 0, 0];
  const area: MapRect = [box[0], box[1], box[2] - box[0], box[3] - box[1]];
  const extent = mapExtent(minimap.mode === "hidden" ? "reading" : minimap.mode, slideExtent, area);
  const sized = minimapBox(minimap.size ?? "full", extent);
  const blocked: ScreenRect[] = [
    magnificationBarRect(size, { open: false, brightnessChanged: false }),
  ];
  if (blockLeft) blocked.push([16, size.height - 60, wholeSlideButtonWidth, 44]);
  if (blockToast) blocked.push([size.width - toastWidth, size.height - 64, toastWidth - 16, 48]);
  const fresh = placeMinimap(size, sized, [], blocked);
  const shownRef = useRef<typeof fresh | null>(null);
  const [resting, setResting] = useState(true);
  const lastCamera = useRef(camera);
  useEffect(() => {
    if (lastCamera.current === camera) return;
    lastCamera.current = camera;
    setResting(false);
    const timer = window.setTimeout(() => setResting(true), 200);
    return () => window.clearTimeout(timer);
  }, [camera]);
  const place = heldPlacement(shownRef.current, fresh, !resting);
  shownRef.current = place;

  const [host, setHost] = useState<HTMLElement | null>(null);
  const attach = useCallback(
    (element: HTMLElement | null) => setHost(element?.parentElement ?? null),
    [],
  );
  const geometry = useRef({ left: 0, top: 0, width: 0, height: 0 });
  geometry.current = { left: place.x, top: place.y, width: sized.width, height: sized.height };
  useEffect(() => {
    if (!host) return;
    const move = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect();
      send({
        type: "POINTER",
        distance: pointerDistance(
          [event.clientX - bounds.left, event.clientY - bounds.top],
          geometry.current,
        ),
      });
    };
    const leave = () => send({ type: "POINTER", distance: Number.POSITIVE_INFINITY });
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, [send, host]);

  const moveView = useCallback(
    (centre: MapPoint) => {
      const look = imageOf(view);
      const [x, y] = fromOverview(look, centre);
      onMoveView({ x, y, scale: camera.scale });
    },
    [view, camera.scale, onMoveView],
  );

  if (minimap.size === null) return null;
  const position = Math.max(1, areas.findIndex((item) => item.object === current) + 1);
  const targetShape = travelTo === null ? undefined : regionShapes[shapeKey(travelTo)];
  const here: MapPoint = [viewport[0] + viewport[2] / 2, viewport[1] + viewport[3] / 2];
  const targetCentre = targetShape ? boxCentre(targetShape.box) : undefined;
  const content = minimapContent({
    mode: minimap.mode === "hidden" ? "reading" : minimap.mode,
    areaCount: areas.length,
    decidedCount: checked.length,
    position,
    magnification,
    cells: cells.flatMap((cell) => {
      const shape = cellShapes[cell.object];
      return shape && cell.object.startsWith(`${current}·`)
        ? [{ point: [shape.x, shape.y] as MapPoint, decided: cell.decided }]
        : [];
    }),
    travel:
      travelTo !== null && targetCentre
        ? {
            label: `area ${Math.max(1, areas.findIndex((item) => item.object === shapeKey(travelTo)) + 1)}`,
            mm: mmBetween(here, targetCentre),
            from: here,
            to: targetCentre,
          }
        : null,
  });
  const shows = (layer: (typeof content.layers)[number]) => content.layers.includes(layer);
  return (
    <SmartMinimap
      ref={attach}
      data-corner={place.corner}
      data-mode={minimap.mode}
      size={minimap.size}
      image={overviewImage}
      extent={extent}
      faded={minimap.faded}
      title={
        <>
          <b>{content.title.strong}</b>
          {content.title.rest}
        </>
      }
      foot={content.foot}
      footEnd={content.footEnd}
      viewport={viewport}
      onOpen={onOpen}
      onPopOut={onPopOut}
      onMoveView={minimap.size === "pip" ? undefined : moveView}
      style={{ left: place.x, top: place.y }}
    >
      {shows("trail") ? <MapTrail rects={seenTrail} /> : null}
      {shows("areas") ? <MinimapAreas areas={areas} checked={checked} current={current} /> : null}
      {shows("outline") ? <MapOutline path={regionShapes[current]?.path ?? ""} /> : null}
      {content.dots ? (
        <MapDots
          dots={content.dots.points}
          done={content.dots.done}
          current={content.dots.current}
        />
      ) : null}
      {content.route ? <MapRoute from={content.route.from} to={content.route.to} /> : null}
      {shows("viewport") ? <MapViewport rect={viewport} /> : null}
    </SmartMinimap>
  );
}
