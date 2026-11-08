import {
  MapOutline,
  MapTrail,
  MapViewport,
  SmartMinimap,
} from "@parfocal/ui/components/smart-minimap";
import { magnificationBarRect } from "@parfocal/ui/lib/magnification-bar";
import { type MapRect, type MinimapSetting, minimapBox } from "@parfocal/ui/lib/minimap-box";
import { mapExtent, pointerDistance } from "@parfocal/ui/lib/minimap-machine";
import { useMinimap } from "@parfocal/ui/lib/use-minimap";
import { useCallback, useEffect, useRef, useState } from "react";
import { overviewSize, regionShapes } from "../review/slide-geometry.ts";
import {
  type Camera,
  imageOf,
  magnificationOf,
  type StillView,
  shapeKey,
} from "../review/slide-still.tsx";
import { lookUrl } from "../thumbnails.ts";
import { placeMinimap, type ScreenRect } from "./minimap-placement.ts";
import { heldPlacement } from "./minimap-weights.ts";
import { type AreaMark, MinimapAreas } from "./slide-maps.tsx";
import { tissueShareOnScreen } from "./tissue-share.ts";
import { seenTrail } from "./tool-geometry.ts";
import { viewportOf } from "./tool-maths.ts";

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
  onOpen,
  onPopOut,
}: {
  setting: MinimapSetting;
  view: StillView;
  camera: Camera;
  size: { width: number; height: number };
  areas: AreaMark[];
  checked: string[];
  blockLeft: boolean;
  blockToast: boolean;
  onOpen: () => void;
  onPopOut: () => void;
}) {
  const viewport = viewportOf(imageOf(view), camera, size);
  const tissueShare = tissueShareOnScreen(viewport);
  const magnification = magnificationOf(view, camera);
  const minimap = useMinimap(setting, { tissueShare, magnification });
  const { send } = minimap;
  useEffect(() => {
    send({ type: "CAMERA", tissueShare, magnification });
  }, [send, tissueShare, magnification]);

  const current = view.kind === "region" ? shapeKey(view.object) : "T2";
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

  if (minimap.size === null) return null;
  const reading = minimap.size === "full" || minimap.size === "travel";
  const position = Math.max(1, areas.findIndex((item) => item.object === current) + 1);
  return (
    <SmartMinimap
      ref={attach}
      data-corner={place.corner}
      data-mode={minimap.mode}
      size={minimap.size}
      image={overviewImage}
      extent={extent}
      faded={minimap.faded}
      title={<b>Whole slide</b>}
      foot={reading ? `${position} of ${areas.length}` : `Area ${position}`}
      footEnd={reading ? `${checked.length} of ${areas.length} decided` : ""}
      onOpen={onOpen}
      onPopOut={onPopOut}
      style={{ left: place.x, top: place.y }}
    >
      {reading ? (
        <>
          <MapTrail rects={seenTrail} />
          <MinimapAreas areas={areas} checked={checked} current={current} />
        </>
      ) : (
        <MapOutline path={regionShapes[current]?.path ?? ""} />
      )}
      {minimap.size === "pip" ? null : <MapViewport rect={viewport} />}
    </SmartMinimap>
  );
}
