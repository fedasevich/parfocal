import type { MapRect } from "@parfocal/ui/lib/minimap-box";
import { regionShapes } from "../review/slide-geometry.ts";
import type { Camera, StillLook } from "../review/slide-still.tsx";
import { cropCentre, imageCentre, perImagePixel } from "./tool-geometry.ts";

export type Size = { width: number; height: number };

export const boxCentre = (box: [number, number, number, number]): [number, number] => [
  (box[0] + box[2]) / 2,
  (box[1] + box[3]) / 2,
];

export function toOverview(look: StillLook, point: [number, number]): [number, number] {
  if (look === "overview") return point;
  const k = perImagePixel[look];
  const centre = cropCentre[look];
  return [centre[0] + (point[0] - imageCentre[0]) * k, centre[1] + (point[1] - imageCentre[1]) * k];
}

export function fromOverview(look: StillLook, point: [number, number]): [number, number] {
  if (look === "overview") return point;
  const k = perImagePixel[look];
  const centre = cropCentre[look];
  return [imageCentre[0] + (point[0] - centre[0]) / k, imageCentre[1] + (point[1] - centre[1]) / k];
}

export function viewportOf(look: StillLook, camera: Camera, size: Size): MapRect {
  const width = size.width / camera.scale;
  const height = size.height / camera.scale;
  const [x, y] = toOverview(look, [camera.x - width / 2, camera.y - height / 2]);
  const k = look === "overview" ? 1 : perImagePixel[look];
  return [x, y, width * k, height * k];
}

const smallestShare = 0.04;

export function insideMap(rect: MapRect, map: MapRect): MapRect {
  const side = (start: number, length: number, from: number, span: number) => {
    const least = Math.min(length, span * smallestShare);
    const low = Math.min(Math.max(start, from), from + span - least);
    const high = Math.max(Math.min(start + length, from + span), low + least);
    return [low, high - low] as const;
  };
  const [x, width] = side(rect[0], rect[2], map[0], map[2]);
  const [y, height] = side(rect[1], rect[3], map[1], map[3]);
  return [x, y, width, height];
}

export const toScreen = (camera: Camera, size: Size, point: [number, number]) => ({
  x: (point[0] - camera.x) * camera.scale + size.width / 2,
  y: (point[1] - camera.y) * camera.scale + size.height / 2,
});

export function areaExtent(object: string): MapRect {
  const box = regionShapes[object]?.box ?? [0, 0, 1400, 1924];
  const pad = 0.12 * Math.max(box[2] - box[0], box[3] - box[1]);
  return [box[0] - pad, box[1] - pad, box[2] - box[0] + 2 * pad, box[3] - box[1] + 2 * pad];
}

const clamp = (value: number, low: number, high: number) =>
  low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value));

export function coverHome(image: Size, centre: [number, number], zoom = 1) {
  return (size: Size): Camera => {
    const scale = Math.max(size.width / image.width, size.height / image.height) * zoom;
    const halfWidth = size.width / 2 / scale;
    const halfHeight = size.height / 2 / scale;
    return {
      x: clamp(centre[0], halfWidth, image.width - halfWidth),
      y: clamp(centre[1], halfHeight, image.height - halfHeight),
      scale,
    };
  };
}
