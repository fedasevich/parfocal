import {
  type MapPoint,
  MapRoute,
  MapViewport,
  SmartMinimap,
} from "@parfocal/ui/components/smart-minimap";
import { useSyncExternalStore } from "react";
import { minimapContent } from "../screens/viewer-tools/minimap-content.ts";
import type { TravelState } from "./travel.ts";
import type { ViewerEngine } from "./viewer-engine.ts";

const blankSlide = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

export function TravelMinimap({
  engine,
  travel,
  label,
  host,
}: {
  engine: ViewerEngine;
  travel: TravelState;
  label: string;
  host: HTMLElement | null;
}) {
  const camera = useSyncExternalStore(engine.subscribeCamera, engine.getCamera);
  const slide = engine.getSlide();
  if (slide === null) return null;
  const box = host?.getBoundingClientRect();
  const scale = 2 ** camera.zoom;
  const width = (box?.width ?? 0) / scale;
  const height = (box?.height ?? 0) / scale;
  const here: MapPoint = [camera.x, camera.y];
  const to: MapPoint = [travel.to[0], travel.to[1]];
  const microns = slide.micronsPerPixel;
  const mm = microns === null ? 0 : (Math.hypot(to[0] - here[0], to[1] - here[1]) * microns) / 1000;
  const content = minimapContent({
    mode: "travel",
    areaCount: 0,
    decidedCount: 0,
    position: 0,
    magnification: 0,
    cells: [],
    travel: { label, mm, from: here, to },
  });
  const viewport: [number, number, number, number] = [
    here[0] - width / 2,
    here[1] - height / 2,
    width,
    height,
  ];
  return (
    <SmartMinimap
      data-testid="travel-minimap"
      data-target={travel.object}
      size="travel"
      image={{ src: blankSlide, width: slide.width, height: slide.height }}
      title={
        <>
          <b>{content.title.strong}</b>
          {microns === null ? "" : content.title.rest}
        </>
      }
      foot={content.foot}
      footEnd={content.footEnd}
      viewport={viewport}
      style={{ right: 16, bottom: 64 }}
    >
      {content.route ? <MapRoute from={content.route.from} to={content.route.to} /> : null}
      <MapViewport rect={viewport} />
    </SmartMinimap>
  );
}
